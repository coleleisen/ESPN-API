const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const espn = require('../scraper/espn');
const { League } = require('../scraper/persistence');
const app = express();
app.use(express.json());
app.use('/scrape', require('../routes/scrape'));
app.use('/fetch', require('../routes/fetch'));
let server, base;
before(async () => {
  server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { await new Promise(resolve => server.close(resolve)); });
const post = (path, body) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('scrape failure returns an error instead of false success, without deleting data', async () => {
  const original = espn.scrape, originalDelete = League.deleteMany;
  let deletes = 0;
  try {
    League.deleteMany = () => { deletes++; };
    espn.scrape = async () => { throw new Error('internal private failure'); };
    const response = await post('/scrape', { username: 'test@example.com', password: 'fixture-password', league: 'IFHL', sport: 'hockey' });
    assert.equal(response.status, 500);
    const data = await response.json();
    assert.equal(data.status, 'fail');
    assert(!data.message.includes('internal private failure'));
    assert.equal(deletes, 0);
  } finally { espn.scrape = original; League.deleteMany = originalDelete; }
});

test('API exposes the verification challenge and completes the resumed scrape', async () => {
  const original = espn.scrape, originalVerify = espn.verify;
  try {
    espn.scrape = async () => ({ verificationRequired: true, challengeId: 'test-challenge', expiresInSeconds: 900 });
    espn.verify = async (id, code) => { assert.equal(id, 'test-challenge'); assert.equal(code, '123456'); return { leagueName: 'IFHL', teams: [{}], sessionToken: 'a'.repeat(64) }; };
    const response = await post('/scrape', { username: 'test@example.com', password: 'fixture-password', league: 'IFHL' });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).challengeId, 'test-challenge');
    const verified = await post('/scrape/verify', { challengeId: 'test-challenge', code: '123456' });
    assert.equal(verified.status, 200);
    const result = await verified.json();
    assert.equal(result.status, 'success');
    assert.equal(result.sessionToken, 'a'.repeat(64));
  } finally { espn.scrape = original; espn.verify = originalVerify; }
});

test('scheduled requests need only a session token and league, without credentials', async () => {
  const original = espn.scrapeWithSession;
  try {
    espn.scrapeWithSession = async (token, league) => {
      assert.equal(token, 'a'.repeat(64));
      assert.equal(league, 'IFHL');
      return { leagueName: league, teams: [{}] };
    };
    const response = await post('/scrape', { sessionToken: 'a'.repeat(64), league: 'IFHL', sport: 'hockey' });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal((await response.json()).status, 'success');
  } finally { espn.scrapeWithSession = original; }
});

test('invalid session tokens are rejected without falling back to a fresh login', async () => {
  const original = espn.scrape;
  let logins = 0;
  try {
    espn.scrape = async () => { logins++; };
    const response = await post('/scrape', { sessionToken: '../invalid', league: 'IFHL' });
    assert.equal(response.status, 401);
    assert.equal((await response.json()).code, 'ESPN_SESSION_NOT_FOUND');
    assert.equal(logins, 0);
  } finally { espn.scrape = original; }
});

test('fetch rejects objects as league names and returns database errors safely', async () => {
  assert.equal((await (await post('/fetch', { league: { $ne: null } })).json()).status, 'fail');
  const original = League.findOne;
  try {
    League.findOne = (query, callback) => callback(new Error('private database details'));
    const response = await post('/fetch', { league: 'IFHL' });
    assert.equal(response.status, 500);
    assert.equal((await response.json()).message, 'Unable to load the league. Please try again.');
  } finally { League.findOne = original; }
});
