const { ScrapeError } = require('./errors');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const identitySelector = '#InputIdentityFlowValue, input[type="email"], input[autocomplete="username"]';
const passwordSelector = 'input[type="password"][autocomplete="current-password"], #InputPassword';
const codeSelector = 'input[autocomplete="one-time-code"], input[id^="otp-code-input-"]';

function loginFrame(page) {
  return page.frames().find(frame => /^(oneid|disneyid)-iframe$/.test(frame.name()));
}

async function state(page) {
  const open = await page.evaluate(() => {
    const wrapper = document.querySelector('#oneid-wrapper, #disneyid-wrapper');
    return !!(wrapper && (wrapper.offsetWidth || wrapper.offsetHeight));
  }).catch(error => {
    if (/execution context was destroyed|cannot find context|frame was detached/i.test(error.message)) return null;
    throw error;
  });
  if (open === null) return 'loading';
  if (!open) return 'closed';
  const frame = loginFrame(page);
  if (!frame) return 'loading';
  return frame.evaluate(({ identitySelector, passwordSelector, codeSelector }) => {
    const visible = selector => Array.from(document.querySelectorAll(selector)).some(el => el.offsetWidth || el.offsetHeight);
    const text = document.body.innerText;
    if (/incorrect|invalid code|code.*expired|doesn.t match|unable to log in|something went wrong|try again later/i.test(text)) return 'error';
    if (/create.*password|create your account/i.test(text)) return 'new-account';
    if (visible(codeSelector)) return 'verification';
    if (visible(passwordSelector)) return 'password';
    if (visible(identitySelector)) return 'identity';
    return 'loading';
  }, { identitySelector, passwordSelector, codeSelector }).catch(() => 'loading');
}

async function waitForState(page, expected, timeout = 45000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const current = await state(page);
    if (current === 'error') throw new ScrapeError('ESPN_LOGIN_REJECTED', 'ESPN could not verify the login or code. Please check it and try again.', 401);
    if (current === 'new-account') throw new ScrapeError('ESPN_ACCOUNT_NOT_FOUND', 'An existing ESPN/MyDisney account is required.', 401);
    if (expected.includes(current)) return current;
    await delay(200);
  }
  throw new ScrapeError('ESPN_LOGIN_TIMEOUT', 'The ESPN login did not finish. Please try again.');
}

async function beginLogin(page, username, password, sport) {
  await page.goto(`https://www.espn.com/fantasy/${sport}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const loginLink = '.account-management a[tref="/members/v3_1/login"]';
  await page.waitForSelector(loginLink);
  // The account menu is hidden until opened; activate its actual login link, not the menu trigger.
  await page.evaluate(selector => document.querySelector(selector).click(), loginLink);
  await waitForState(page, ['identity']);
  let frame = loginFrame(page);
  if (!username.includes('@')) {
    await frame.evaluate(() => {
      const link = Array.from(document.querySelectorAll('a,button')).find(el => /looking for username login/i.test(el.textContent));
      if (link) link.click();
    });
  }
  await frame.waitForSelector(identitySelector, { visible: true });
  await frame.type(identitySelector, username, { delay: 30 });
  await frame.click('#BtnSubmit');
  const next = await waitForState(page, ['password', 'verification']);
  if (next === 'verification') return { verificationRequired: true };
  frame = loginFrame(page);
  await frame.type(passwordSelector, password, { delay: 30 });
  await frame.click('#BtnSubmit');
  const outcome = await waitForState(page, ['verification', 'closed']);
  return { verificationRequired: outcome === 'verification' };
}

async function submitVerification(page, code) {
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) {
    throw new ScrapeError('INVALID_VERIFICATION_CODE', 'Enter the six-digit verification code from ESPN.', 400);
  }
  const frame = loginFrame(page);
  if (!frame) throw new ScrapeError('ESPN_LOGIN_EXPIRED', 'The ESPN login session expired. Start the scrape again.', 410);
  const fieldCount = await frame.$$eval(codeSelector, fields => fields.length);
  if (!fieldCount) {
    // The provider can finish verification automatically while its iframe is changing.
    if (await state(page) === 'closed') return;
    throw new ScrapeError('ESPN_LOGIN_EXPIRED', 'The ESPN verification form is no longer available. Start the scrape again.', 410);
  }
  for (let i = 0; i < fieldCount; i++) {
    // MyDisney may replace all six inputs after each keystroke. Do not retain stale handles.
    const field = await frame.evaluateHandle(({ selector, index }) => document.querySelectorAll(selector)[index], { selector: codeSelector, index: i });
    try {
      const input = field.asElement();
      if (!input) throw new ScrapeError('ESPN_LOGIN_EXPIRED', 'The ESPN verification form is no longer available. Start the scrape again.', 410);
      await input.click({ clickCount: 3 });
      await input.type(fieldCount === 1 ? code : code[i]);
    } finally { await field.dispose(); }
  }
  // Some versions auto-submit the sixth digit and remove the button/iframe immediately.
  try {
    await frame.evaluate(() => {
      const button = document.querySelector('#BtnSubmit');
      if (button && !button.disabled && button.getClientRects().length) button.click();
    });
  } catch (error) {
    if (!/execution context was destroyed|cannot find context|frame was detached|detached frame/i.test(error.message)) throw error;
  }
  await waitForState(page, ['closed']);
}

async function assertAuthenticated(page, sport = 'basketball') {
  await page.goto(`https://www.espn.com/fantasy/${sport}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  try {
    // ESPN's member service updates this flag when it restores the browser's login.
    await page.waitForFunction(() => window.espn && window.espn.core && window.espn.core.loggedIn === true, { timeout: 20000 });
  } catch (error) {
    if (error.name !== 'TimeoutError') throw error;
    const signedOut = await page.evaluate(() => !!document.querySelector('.account-management a[tref="/members/v3_1/login"]'));
    if (signedOut) throw new ScrapeError('ESPN_REAUTH_REQUIRED', 'ESPN needs a new verified login before scheduled scraping can resume.', 401);
    throw new ScrapeError('ESPN_SESSION_CHECK_FAILED', 'ESPN login status could not be checked. Retry later; the saved session was retained.');
  }
}

module.exports = { beginLogin, submitVerification, loginFrame, assertAuthenticated };
