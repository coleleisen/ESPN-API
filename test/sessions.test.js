const { test } = require('node:test');
const assert = require('node:assert/strict');
const { LoginSessions } = require('../scraper/sessions');

test('verification sessions prevent concurrent use and close expired browsers', async () => {
  let closed = 0;
  const store = new LoginSessions(50);
  const result = store.add({ browser: { close: async () => { closed++; } } });
  assert.equal(result.verificationRequired, true);
  store.acquire(result.challengeId);
  assert.throws(() => store.acquire(result.challengeId), { code: 'VERIFICATION_IN_PROGRESS' });
  store.release(result.challengeId);
  store.acquire(result.challengeId);
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(closed, 1);
  assert.throws(() => store.acquire(result.challengeId), { code: 'ESPN_LOGIN_EXPIRED' });
});
