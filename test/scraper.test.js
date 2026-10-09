const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createScraper } = require('../scraper/espn');
const { ScrapeError } = require('../scraper/errors');

function fixture(overrides = {}) {
  const calls = { launches: 0, logins: 0, closes: 0, writes: 0 };
  const page = { setDefaultTimeout() {} };
  const profilePaths = [];
  const profile = {
    token: 'a'.repeat(64), userDataDir: 'fixture-profile', verified: false,
    setVerified: async value => { profile.verified = value; },
    release() {}, discard: async () => { profile.verified = false; }
  };
  const profileStore = {
    create: async () => profile,
    open: async token => {
      if (token !== profile.token || !profile.verified) throw new ScrapeError('ESPN_REAUTH_REQUIRED', 'Sign in again.', 401);
      return profile;
    }
  };
  const scraper = createScraper({
    profileStore,
    launchBrowser: async options => { calls.launches++; profilePaths.push(options.userDataDir); return { newPage: async () => page, close: async () => { calls.closes++; } }; },
    beginLogin: async () => { calls.logins++; return { verificationRequired: true }; },
    assertAuthenticated: async () => {},
    submitVerification: async actualPage => { assert.equal(actualPage, page); },
    collectLeague: async (actualPage, target) => { assert.equal(actualPage, page); return { leagueName: target.leagueName, teams: [{}] }; },
    saveLeague: async league => { calls.writes++; return league; },
    ...overrides
  });
  return { scraper, calls, profile, profilePaths };
}

test('verification resumes the same browser without storing or resubmitting credentials', async () => {
  const { scraper, calls } = fixture();
  const pending = await scraper.scrape('test@example.com', 'fixture-password', 'IFHL', { sport: 'hockey' });
  assert.deepEqual(calls, { launches: 1, logins: 1, closes: 0, writes: 0 });
  assert.equal(pending.verificationRequired, true);
  const league = await scraper.verify(pending.challengeId, '123456');
  assert.equal(league.leagueName, 'IFHL');
  assert.deepEqual(calls, { launches: 1, logins: 1, closes: 1, writes: 1 });
  await assert.rejects(scraper.verify(pending.challengeId, '123456'), { code: 'ESPN_LOGIN_EXPIRED' });
});

test('a failed table read closes the browser without saving partial data', async () => {
  const { scraper, calls } = fixture({
    beginLogin: async () => ({ verificationRequired: false }),
    collectLeague: async () => { throw new Error('missing table'); }
  });
  await assert.rejects(scraper.scrape('test@example.com', 'fixture-password', 'IFHL', { sport: 'hockey' }), /missing table/);
  assert.equal(calls.writes, 0);
  assert.equal(calls.closes, 1);
});

test('a technical verification failure retains the same challenge for retry', async () => {
  let attempts = 0;
  const { scraper, calls } = fixture({ submitVerification: async () => {
    if (attempts++ === 0) throw new Error('frame changed during verification');
  } });
  const pending = await scraper.scrape('test@example.com', 'fixture-password', 'IFHL', { sport: 'hockey' });
  await assert.rejects(scraper.verify(pending.challengeId, '123456'), /frame changed/);
  assert.equal(calls.closes, 0);
  assert.equal(calls.writes, 0);
  assert.equal((await scraper.verify(pending.challengeId, '123456')).leagueName, 'IFHL');
  assert.equal(calls.logins, 1);
});

test('invalid sport and league IDs are rejected before launching a browser', async () => {
  const { scraper, calls } = fixture();
  await assert.rejects(scraper.scrape('test@example.com', 'fixture-password', 'IFHL', { sport: 'unknown' }), { code: 'INVALID_SPORT' });
  await assert.rejects(scraper.scrape('test@example.com', 'fixture-password', 'IFHL', { sport: 'hockey', leagueId: '../other' }), { code: 'INVALID_LEAGUE_ID' });
  assert.equal(calls.launches, 0);
});

test('subsequent scrapes reuse the verified profile without login or another code', async () => {
  const { scraper, calls, profilePaths } = fixture();
  const pending = await scraper.scrape('test@example.com', 'fixture-password', 'IFHL', { sport: 'hockey' });
  const result = await scraper.verify(pending.challengeId, '123456');
  assert.match(result.sessionToken, /^[a-f0-9]{64}$/);
  await scraper.scrapeWithSession(result.sessionToken, 'IFHL', { sport: 'hockey' });
  assert.deepEqual(calls, { launches: 2, logins: 1, closes: 2, writes: 2 });
  assert.equal(profilePaths[0], profilePaths[1]);
});

test('expired ESPN sessions require reauthentication without sending more login attempts', async () => {
  let expired = false;
  const { scraper, calls, profile } = fixture({
    assertAuthenticated: async () => {
      if (expired) throw new ScrapeError('ESPN_REAUTH_REQUIRED', 'Sign in again.', 401);
    }
  });
  const pending = await scraper.scrape('test@example.com', 'fixture-password', 'IFHL', { sport: 'hockey' });
  const result = await scraper.verify(pending.challengeId, '123456');
  expired = true;
  await assert.rejects(scraper.scrapeWithSession(result.sessionToken, 'IFHL', { sport: 'hockey' }), { code: 'ESPN_REAUTH_REQUIRED' });
  assert.equal(profile.verified, false);
  assert.equal(calls.logins, 1);
  assert.equal(calls.writes, 1);
});

test('temporary errors retain the verified session even if the first scrape fails', async () => {
  const { scraper, profile } = fixture({
    beginLogin: async () => ({ verificationRequired: false }),
    collectLeague: async () => { throw new Error('temporary ESPN outage'); }
  });
  await assert.rejects(scraper.scrape('test@example.com', 'fixture-password', 'IFHL', { sport: 'hockey' }), error => {
    assert.equal(error.sessionToken, profile.token);
    return error.message === 'temporary ESPN outage';
  });
  assert.equal(profile.verified, true);
  await assert.rejects(scraper.scrapeWithSession(profile.token, 'IFHL', { sport: 'hockey' }), /temporary ESPN outage/);
  assert.equal(profile.verified, true);
});
