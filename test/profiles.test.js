const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { ProfileStore } = require('../scraper/profiles');
const { launchBrowser } = require('../scraper/browser');
const { assertAuthenticated } = require('../scraper/auth');

async function temporaryStore(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'espn-profile-test-'));
  t.after(async () => {
    const resolved = path.resolve(root);
    if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('espn-profile-test-')) throw new Error('Unsafe test cleanup');
    await fs.rm(resolved, { recursive: true, force: true });
  });
  return new ProfileStore(root);
}

test('saved sessions require an unguessable token, verification and exclusive use', async t => {
  const store = await temporaryStore(t);
  const profile = await store.create();
  assert.match(profile.token, /^[a-f0-9]{64}$/);
  assert(!profile.userDataDir.includes(profile.token));
  await assert.rejects(store.open(profile.token), { code: 'ESPN_REAUTH_REQUIRED' });
  await profile.setVerified(true);
  await assert.rejects(store.open(profile.token), { code: 'ESPN_SESSION_BUSY' });
  profile.release();
  const reopened = await new ProfileStore(store.root).open(profile.token);
  assert.equal(reopened.userDataDir, profile.userDataDir);
  reopened.release();
  await assert.rejects(store.open('../escape'), { code: 'ESPN_SESSION_NOT_FOUND' });
  await assert.rejects(store.open('0'.repeat(64)), { code: 'ESPN_SESSION_NOT_FOUND' });
  await profile.discard();
  await assert.rejects(store.open(profile.token), { code: 'ESPN_SESSION_NOT_FOUND' });
});

async function interceptedPage(browser, seed) {
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on('request', request => {
    if (!request.url().startsWith('https://www.espn.com/fantasy/')) return request.abort();
    return request.respond({
      contentType: 'text/html',
      headers: seed ? { 'set-cookie': 'fixture_auth=valid; Max-Age=3600; Path=/; Secure; SameSite=Lax' } : {},
      body: `<!doctype html><body><script>
        ${seed ? "localStorage.setItem('fixture_user', 'confirmed');" : ''}
        window.espn = {core: {loggedIn: localStorage.getItem('fixture_user') === 'confirmed' && document.cookie.includes('fixture_auth=valid')}};
      </script>`
    });
  });
  return page;
}

test('cookies and local storage survive a full browser restart for an automated scrape', async t => {
  const store = await temporaryStore(t);
  const profile = await store.create();
  let browser;
  let active = profile;
  try {
    browser = await launchBrowser({ userDataDir: profile.userDataDir });
    await assertAuthenticated(await interceptedPage(browser, true), 'hockey');
    await profile.setVerified(true);
    await browser.close();
    browser = null;
    profile.release();

    active = await new ProfileStore(store.root).open(profile.token);
    browser = await launchBrowser({ userDataDir: active.userDataDir });
    const page = await interceptedPage(browser, false);
    await assertAuthenticated(page, 'hockey');
    assert.equal(await page.evaluate(() => window.espn.core.loggedIn), true);
    assert.equal(await page.$('input[type="password"]'), null);
  } finally {
    if (browser) await browser.close();
    await active.discard();
  }
});
