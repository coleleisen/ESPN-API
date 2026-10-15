const { test } = require('node:test');
const assert = require('node:assert/strict');
const { discoverGameId, parseAdpPage, collectYahooAdp, SOURCE } = require('../advisor/yahoo-adp');
const { createYahooAdpStore } = require('../advisor/yahoo-adp-store');
const { attachYahooAdp, playerAdp } = require('../advisor/yahoo-adp-context');
const { buildContext, lookupPlayers, promptContext } = require('../advisor/context');
const { SIX_HOURS } = require('../advisor/public-cache');

const at = new Date('2026-10-15T12:00:00Z');
const html = '<script>var sportCode = "nba"; var gameId = "478"; var type = "standard"; window.bootstrapFantasyStatTable(context);</script>';
const row = (id, changes = {}) => ({ player: { player_key: `478.p.${id}`, player_id: String(id), name: { full: `Player ${id}` },
  draft_analysis: { average_pick: String(Number(id) + 0.5), percent_drafted: '0.50' }, ...changes } });
const page = (players, changes = {}) => ({ fantasy_content: { league: { game_code: 'nba', season: '2026', league_key: '478.l.101',
  players, 'players:attributes': { count: players.length }, ...changes } } });
const data = () => ({ seasonId: 2027, yahooSeason: 2026, gameId: '478', fetchedAt: at.toISOString(), checkedAt: at.toISOString(),
  players: [{ id: '20', name: 'Player 1', adp: 5.5, percentDrafted: 100 }, { id: '21', name: 'Player 2', adp: 120.2, percentDrafted: 10 },
    { id: '22', name: 'Trey Murphy', adp: 25.2, percentDrafted: 97 }, { id: '23', name: 'Nic Claxton', adp: 100.1, percentDrafted: 70 }] });
const args = changes => ({ query: '', teamId: '', availability: 'available', period: 'projections', sortBy: 'YAHOO_ADP', ascending: true,
  excludeCategories: ['AST'], minGames: 0, offset: 0, limit: 8, detail: 'scoring', ...changes });

test('Yahoo parser verifies basketball season/game and reads ADP rather than expert rank, salary or premium values', () => {
  assert.equal(discoverGameId(html), '478');
  assert.throws(() => discoverGameId(html.replace('nba', 'nhl')), /settings/);
  assert.throws(() => discoverGameId(html.replace('standard', 'salcap')), /settings/);
  assert.throws(() => discoverGameId('<h1>Login</h1>'), /settings/);
  const p = row(1, { player_ranks: [{ player_rank: { rank_value: '99' } }],
    draft_analysis: { average_pick: '5.6', percent_drafted: '0', average_cost: '45', preseason_average_pick: '8', cut_types: [{ average_pick: '3' }] } });
  assert.deepEqual(parseAdpPage(page([p]), 2027, '478'), [{ id: '1', name: 'Player 1', adp: 5.6, percentDrafted: 0 }]);
  assert.equal(parseAdpPage(page([row(1, { draft_analysis: { average_pick: '-', percent_drafted: '-' } })]), 2027, '478')[0].adp, null);
  for (const changes of [{ season: '2025' }, { game_code: 'nhl' }, { league_key: '999.l.101' }]) {
    assert.throws(() => parseAdpPage(page([p], changes), 2027, '478'), /season/);
  }
  for (const bad of ['zero', -1, 0, 1501, Infinity]) {
    assert.throws(() => parseAdpPage(page([row(1, { draft_analysis: { average_pick: bad } })]), 2027, '478'), /value/);
  }
  assert.throws(() => parseAdpPage(page([row(1, { draft_analysis: { average_pick: 5, percent_drafted: 50 } })]), 2027, '478'), /value/);
  assert.throws(() => parseAdpPage(page([row(1)], { 'players:attributes': { count: 2 } }), 2027, '478'), /Incomplete/);
  assert.throws(() => parseAdpPage(page([row(1, { player_key: '999.p.1' })]), 2027, '478'), /identity/);
});

test('Yahoo collector paginates the whole anonymous public pool and refuses a partial, repeated or cross-season refresh', async () => {
  const requests = [];
  const first = Array.from({ length: 100 }, (_, i) => row(i + 1));
  const second = [row(101, { draft_analysis: { average_pick: '-', percent_drafted: '-' } }), row(102)];
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    return new Response(url === SOURCE ? html : JSON.stringify(page(url.includes('start=0;') ? first : second)));
  };
  const result = await collectYahooAdp(2027, { fetchImpl, now: at });
  assert.equal(result.seasonId, 2027);
  assert.equal(result.yahooSeason, 2026);
  assert.equal(result.scannedPlayers, 102);
  assert.equal(result.players.length, 101);
  assert.equal(result.players.at(-1).id, '102');
  assert.equal(requests.length, 3);
  assert.ok(requests.every(({ url, options }) => options.redirect === 'error' && !options.headers.Authorization && !options.headers.Cookie
    && (url === SOURCE || url.startsWith('https://pub-api-ro.fantasysports.yahoo.com/fantasy/v2/league/478.l.public/'))));
  const withSecond = response => (url => Promise.resolve(new Response(url === SOURCE ? html
    : JSON.stringify(url.includes('start=0;') ? page(first) : response))));
  await assert.rejects(collectYahooAdp(2027, { fetchImpl: withSecond(page([row(1)])) }), /repeated/);
  await assert.rejects(collectYahooAdp(2027, { fetchImpl: withSecond(page(second, { season: '2025' })) }), /season/);
  await assert.rejects(collectYahooAdp(2027, { fetchImpl: withSecond({ error: 'Unavailable' }) }), /season/);
  await assert.rejects(collectYahooAdp(2027, { fetchImpl: async url => new Response(url === SOURCE ? html : JSON.stringify(page([]))) }), /empty/);
});

test('Yahoo context uses only matching current-season names, keeps missing ADP unknown, and preserves ESPN ownership', () => {
  const league = { leagueName: 'Fixture', leagueId: '1', seasonId: 2027, sport: 'basketball' };
  const players = ['Player 1', 'Player 2', 'Trey Murphy III', 'Nicolas Claxton', 'New Rookie'].map((name, i) => ({ id: String(i + 1), name,
    teamId: i === 0 ? 'a' : null, status: i === 0 ? 'ONTEAM' : 'WAIVERS', statistics: [], percentOwned: 5 }));
  const base = buildContext(league, { leagueId: '1', seasonId: 2027, updatedAt: at.toISOString(), data: {
    players, playerPoolComplete: true, teams: [{ id: 'a', name: 'Team A' }], rules: { scoringCategories: [] } } }, at);
  const context = attachYahooAdp(base, { data: data() }, at);
  assert.equal(context.metadata.yahooAdp.matchedPlayers, 4);
  assert.equal(playerAdp(context, players[0]).adp, 5.5); // Matches by name, never by provider ID.
  assert.equal(playerAdp(context, players[4]), null);
  const result = lookupPlayers(context, args());
  assert.deepEqual(result.players.map(p => p.name), ['Trey Murphy III', 'Nicolas Claxton', 'Player 2', 'New Rookie']);
  assert.ok(result.players.every(p => p.status === 'WAIVERS' && !p.teamId));
  assert.equal(result.players[0].yahooAdp.adp, 25.2);
  assert.equal(lookupPlayers(context, args({ ascending: false })).players[0].name, 'Player 2');
  const prompt = promptContext(context, 'a');
  assert.deepEqual(prompt.selectedRoster.yahooAdp.rows, [['1', 5.5, 100]]);
  assert.ok(!JSON.stringify(prompt).includes('120.2')); // Other player values stay in the bounded lookup tool.
  const mismatch = attachYahooAdp(base, { data: { ...data(), seasonId: 2026, yahooSeason: 2025 } }, at);
  assert.equal(mismatch.metadata.yahooAdp.available, false);
  assert.equal(playerAdp(mismatch, players[0]), null);
  assert.match(lookupPlayers(mismatch, args()).error, /older Yahoo/);
  assert.equal(attachYahooAdp({ ...base, metadata: { ...base.metadata, sport: 'hockey' } }, { data: data() }).metadata.yahooAdp, undefined);
  assert.match(attachYahooAdp(base, { data: data() }, new Date(at.getTime() + SIX_HOURS + 1)).metadata.yahooAdp.warnings.join(' '), /six hours/);
});

test('Yahoo cache reuses data, shares refreshes, persists cooldowns, and rejects wrong-season or empty replacements', async () => {
  let time = at.getTime(), calls = 0, mode = 'ok';
  const records = new Map();
  const store = createYahooAdpStore({ now: () => time, read: async year => records.get(year),
    write: async (year, changes) => { const record = { ...records.get(year), ...changes }; records.set(year, record); return record; },
    collect: async () => { calls++; if (mode === 'fail') throw new Error('private upstream details');
      return mode === 'empty' ? { ...data(), players: [] } : mode === 'old' ? { ...data(), seasonId: 2026, yahooSeason: 2025 } : data(); } });
  assert.equal(await store(2027), undefined); assert.equal(calls, 0);
  const [one, two] = await Promise.all([store(2027, { refresh: true }), store(2027, { refresh: true })]);
  assert.deepEqual(one, two); assert.equal(calls, 1);
  await store(2027, { refresh: true, force: true }); assert.equal(calls, 1);
  time += 60 * 60 * 1000;
  await store(2027, { refresh: true }); assert.equal(calls, 1);
  for (const failure of ['old', 'empty', 'fail']) {
    mode = failure; time += SIX_HOURS;
    const priorCalls = calls;
    const saved = await store(2027, { refresh: true });
    assert.deepEqual(saved.data, one.data);
    assert.match(saved.lastError, /retained/);
    assert.ok(!saved.lastError.includes('private'));
    await store(2027, { refresh: true, force: true }); assert.equal(calls, priorCalls + 1);
  }
  assert.equal((await store(2028, { refresh: true })).data, undefined); // Never substitute another season.
});
