const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { launchBrowser } = require('../scraper/browser');
const { beginLogin, submitVerification, loginFrame, assertAuthenticated } = require('../scraper/auth');

let browser;
before(async () => { browser = await launchBrowser(); });
after(async () => { if (browser) await browser.close(); });

const loginHTML = `<!doctype html><body><main>
  <input id="InputIdentityFlowValue" type="email" autocomplete="email">
  <button id="BtnSubmit" type="submit">Continue</button>
  </main><script>
  let stage = 'email'; window.submitted = {};
  document.addEventListener('click', event => {
    if (event.target.id !== 'BtnSubmit') return;
    const main = document.querySelector('main');
    if (stage === 'email') {
      window.submitted.email = document.querySelector('input').value;
      main.innerHTML = '<input id="InputPassword" type="password" autocomplete="current-password"><button id="BtnSubmit">Log In</button>';
      stage = 'password';
    } else if (stage === 'password') {
      window.submitted.password = document.querySelector('input').value;
      main.innerHTML = Array.from({length:6}, (_, i) => '<input id="otp-code-input-' + i + '" autocomplete="one-time-code" type="tel">').join('') + '<button id="BtnSubmit">Continue</button>';
      stage = 'code';
    } else {
      window.submitted.code = Array.from(document.querySelectorAll('input')).map(i => i.value).join('');
      if (window.submitted.code === '123456') parent.postMessage('logged-in', '*');
      else main.insertAdjacentHTML('beforeend', '<p>Invalid code</p>');
    }
  });</script>`;

async function fixture({ replaceInputs = false, autoSubmit = false } = {}) {
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on('request', request => {
    if (request.url().startsWith('https://www.espn.com/fantasy/')) {
      return request.respond({ contentType: 'text/html', body: `<!doctype html><body>
        <input id="site-search"><ul class="account-management"><li><a tref="/members/v3_1/login" onclick="document.querySelector('#oneid-wrapper').style.display='block'">Log In</a></li></ul>
        <div id="oneid-wrapper" style="display:none"><iframe name="oneid-iframe" src="https://cdn.registerdisney.go.com/login-test"></iframe></div>
        <script>addEventListener('message', e => { if(e.data === 'logged-in') { document.querySelector('#oneid-wrapper').style.display='none'; ${autoSubmit ? "document.querySelector('iframe').remove();" : ''} } });</script>` });
    }
    if (request.url() === 'https://cdn.registerdisney.go.com/login-test') {
      return request.respond({ contentType: 'text/html', body: loginHTML + `<script>
        document.addEventListener('input', event => {
          if (!event.target.id.startsWith('otp-code-input-')) return;
          ${replaceInputs ? "document.querySelectorAll('input').forEach(input => { const copy = input.cloneNode(); copy.value = input.value; input.replaceWith(copy); });" : ''}
          ${autoSubmit ? "if (Array.from(document.querySelectorAll('input')).map(i => i.value).join('') === '123456') parent.postMessage('logged-in', '*');" : ''}
        });</script>` });
    }
    return request.abort();
  });
  return page;
}

test('login fills separate iframe fields and resumes a six-field verification code', async () => {
  const page = await fixture();
  try {
    assert.deepEqual(await beginLogin(page, 'test@example.com', 'fixture-password', 'hockey'), { verificationRequired: true });
    assert.equal(await page.$eval('#site-search', el => el.value), '');
    await submitVerification(page, '123456');
    assert.deepEqual(await loginFrame(page).evaluate(() => window.submitted), {
      email: 'test@example.com', password: 'fixture-password', code: '123456'
    });
  } finally { await page.close(); }
});

test('invalid verification codes are surfaced as failures', async () => {
  const page = await fixture();
  try {
    await beginLogin(page, 'test@example.com', 'fixture-password', 'hockey');
    await assert.rejects(submitVerification(page, '000000'), { code: 'ESPN_LOGIN_REJECTED', status: 401 });
    await assert.rejects(submitVerification(page, 'abc'), { code: 'INVALID_VERIFICATION_CODE', status: 400 });
  } finally { await page.close(); }
});

test('verification tolerates replaced inputs and an iframe removed on the final digit', async () => {
  const page = await fixture({ replaceInputs: true, autoSubmit: true });
  try {
    await beginLogin(page, 'test@example.com', 'fixture-password', 'hockey');
    await submitVerification(page, '123456');
    assert.equal(loginFrame(page), undefined);
  } finally { await page.close(); }
});

test('expired login is distinguished from an unknown page or temporary network failure', async () => {
  const timeout = new Error('fixture timeout');
  timeout.name = 'TimeoutError';
  const page = { goto: async () => {}, waitForFunction: async () => { throw timeout; }, evaluate: async () => true };
  await assert.rejects(assertAuthenticated(page, 'hockey'), { code: 'ESPN_REAUTH_REQUIRED', status: 401 });
  page.evaluate = async () => false;
  await assert.rejects(assertAuthenticated(page, 'hockey'), { code: 'ESPN_SESSION_CHECK_FAILED', status: 502 });
  page.goto = async () => { throw new Error('network unavailable'); };
  await assert.rejects(assertAuthenticated(page, 'hockey'), /network unavailable/);
});
