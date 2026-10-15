const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseRankings, collectPublicRankings, CATEGORY_COLUMNS } = require('../advisor/basketball-monster');
const { createRankingsStore, SIX_HOURS } = require('../advisor/rankings-store');
const { attachRankings, playerRanking } = require('../advisor/ranking-context');
const { lookupPlayers, promptContext } = require('../advisor/context');

const at = new Date('2026-10-15T05:00:00Z');
const cats = Object.keys(CATEGORY_COLUMNS);
function row(id, name, changes = {}) {
  return { id, name, rank: Number(id), overallValue: 0, games: 50, zScores: Object.fromEntries(cats.map(c => [c, 0])), ...changes };
}
function html(year = 2026, players = [row('1', 'Player One')]) {
  const label = `NBA ${String(year - 1).slice(-2)}-${String(year).slice(-2)}`;
  const headings = ['Name', 'Rank', 'Value', 'g', ...Object.values(CATEGORY_COLUMNS)];
  return `<h1>Player Rankings ${label.slice(4)}</h1><form><input type="hidden" name="__VIEWSTATE" value="opaque"><select name="DataSetControl"><option selected value="${year}">${label}</option></select>
    <select name="DateFilterControl"><option selected>FullSeason</option></select><select name="ValueDisplayType"><option selected>PerGame</option></select>
    <select name="PlayerFilterControl"><option selected>AllPlayers</option></select><input name="PuntCategoriesControl_weight_1" type="number">
    ${players.length ? `<table><tr>${headings.map(h => `<th>${h}</th>`).join('')}</tr>${players.map(p => `<tr><td><a href="playerinfo.aspx?i=${p.id}">${p.name}</a></td>${[p.rank, p.overallValue, p.games, ...cats.map(c => p.zScores[c])].map(v => `<td>${v == null ? '' : v}</td>`).join('')}</tr>`).join('')}</table>` : ''}</form>`;
}
function saved(players = [row('1', 'Player One')], current = []) {
  return { data: { seasonId: 2027, checkedAt: at.toISOString(), datasets: [parseRankings(html(2027, current), 2027, at), parseRankings(html(2026, players), 2026, at)] } };
}
function contextFor(players) {
  const metadata = { seasonId: 2027, sport: 'basketball', playerPoolComplete: true, currentTime: at.toISOString(), warnings: [] };
  const rules = { scoringType: 'H2H_MOST_CATEGORIES', scoringCategories: cats.map(name => ({ name })) };
  return { metadata, rules, teams: [{ id: 'a' }], initial: { metadata, rules, teams: [] }, players: players.map((p, i) => ({
    id: String(i + 10), name: p.name, teamId: i === 0 ? 'a' : null, status: i === 0 ? 'ONTEAM' : 'FREEAGENT', statistics: [], ...p })) };
}
const args = changes => ({ query: '', teamId: '', availability: 'available', period: 'projections', sortBy: 'BBM_FIT', ascending: false,
  excludeCategories: [], minGames: 0, offset: 0, limit: 8, detail: 'scoring', ...changes });

test('public ranking parser preserves signed category values and zero, validates season/settings, and rejects partial rows', () => {
  const player = row('1', 'Player One', { zScores: { ...row('1', '').zScores, TO: -2.3, AST: 1.2 } });
  const page = html(2026, [player]);
  const data = parseRankings(page, 2026, at);
  assert.equal(data.players[0].zScores.TO, -2.3);
  assert.equal(data.players[0].zScores.PTS, 0);
  assert.equal(data.kind, 'actual');
  assert.equal(data.basis, 'per game');
  assert.throws(() => parseRankings(page, 2027), /season/);
  assert.throws(() => parseRankings(page.replace('PerGame', 'Total'), 2026), /settings/);
  assert.throws(() => parseRankings(page.replace('</form>', '<input name="cat_1" type="checkbox" checked></form>'), 2026), /settings/);
  assert.throws(() => parseRankings(page.replace('<th>fg%V</th>', '<th>fg%</th>'), 2026), /columns/);
  assert.throws(() => parseRankings(page.replace('<td>-2.3</td>', '<td></td>'), 2026), /Missing/);
  assert.throws(() => parseRankings(html(2026, [player, player]), 2026), /pool/);
  assert.equal(parseRankings(html(2027, []), 2027).players.length, 0);
  assert.throws(() => parseRankings('<h1>Login</h1>', 2027), /season/);
});

test('public collector discovers exact season IDs and submits all-player settings without sending league information', async () => {
  const requests = [];
  const landing = html(2026).replace('</select>', '<option value="2027">NBA 26-27</option></select>');
  const result = await collectPublicRankings(2027, { now: at, fetchImpl: async (url, options) => {
    requests.push({ url, options });
    if (options.method === 'POST') {
      const params = new URLSearchParams(options.body);
      assert.equal(params.get('PlayerFilterControl'), 'AllPlayers');
      assert.equal(params.get('__VIEWSTATE'), 'opaque');
      assert.equal(params.get('ValueDisplayType'), 'PerGame');
    }
    const year = new URL(url).searchParams.get('ds');
    return new Response(year === '2027' ? html(2027, []) : landing);
  } });
  assert.deepEqual(result.datasets.map(d => [d.seasonId, d.players.length]), [[2027, 0], [2026, 1]]);
  assert.equal(requests.length, 4);
  assert.ok(requests.every(r => r.url.startsWith('https://basketballmonster.com/playerrankings.aspx')));
  await assert.rejects(collectPublicRankings(2027, { fetchImpl: async () => new Response('', { status: 302, headers: { location: 'https://example.com/login' } }) }), /redirected/);
});

test('matching handles accents, suffixes and known aliases without ambiguous surname matches; historical seasons stay labeled', () => {
  const source = saved([row('1', 'Nikola Jokic'), row('2', 'Trey Murphy'), row('3', 'Nicolas Claxton'), row('4', 'Jordan Example')]);
  const context = attachRankings(contextFor([{ name: 'Nikola Jokić' }, { name: 'Trey Murphy III' }, { name: 'Nic Claxton' },
    { name: 'Jordan Example Jr.' }, { name: 'Jordan Example Sr.' }, { name: 'New Rookie' }]), source, at);
  assert.equal(context.metadata.basketballMonster.seasonId, 2026);
  assert.equal(context.metadata.basketballMonster.currentSeasonAvailable, false);
  assert.equal(context.metadata.basketballMonster.matchedPlayers, 3);
  assert.equal(playerRanking(context, context.players[0]).zScores.PTS, 0);
  assert.equal(playerRanking(context, context.players[3]), null);
  assert.equal(playerRanking(context, context.players[5]), null);
  assert.match(context.metadata.basketballMonster.warnings.join(' '), /historical/);
  const prompt = promptContext(context, 'a');
  assert.equal(prompt.selectedRoster.basketballMonster.rows.length, 1);
  assert.ok(!JSON.stringify(prompt).includes('sourcePlayerId'));
});

test('punt-aware rankings change candidate order, preserve turnover direction, filter samples and respect ESPN ownership', () => {
  const scorer = row('2', 'Scorer', { zScores: { ...row('2', '').zScores, PTS: 4, AST: -1, TO: 1 } });
  const passer = row('3', 'Passer', { zScores: { ...row('3', '').zScores, PTS: 1, AST: 8, TO: -1 } });
  const tiny = row('4', 'Tiny Sample', { games: 1, zScores: Object.fromEntries(cats.map(c => [c, 5])) });
  const context = attachRankings(contextFor([{ name: 'Owned' }, { name: 'Scorer' }, { name: 'Passer' }, { name: 'Tiny Sample' }, { name: 'Rookie' }]), saved([row('1', 'Owned'), scorer, passer, tiny]), at);
  assert.equal(lookupPlayers(context, args({ minGames: 10 })).players[0].name, 'Passer');
  const punt = lookupPlayers(context, args({ minGames: 10, excludeCategories: ['AST'] }));
  assert.equal(punt.players[0].name, 'Scorer');
  assert.equal(punt.players[0].basketballMonster.fitScore, 0.625);
  assert.equal(punt.players[0].basketballMonster.zScores.TO, 1);
  assert.equal(punt.basketballMonster.seasonId, 2026);
  assert.ok(!punt.players.some(p => p.name === 'Owned' || p.name === 'Tiny Sample'));
  assert.equal(lookupPlayers(context, args({ query: 'Rookie' })).players[0].basketballMonster, null);
  assert.equal(lookupPlayers(context, args({ sortBy: 'BBM_TO', minGames: 10 })).players[0].name, 'Scorer');
  assert.throws(() => lookupPlayers(context, args({ excludeCategories: ['UNKNOWN'] })), /Invalid/);
  const fresh = attachRankings(context, saved([scorer], [passer]), at);
  assert.equal(fresh.metadata.basketballMonster.seasonId, 2027);
  assert.equal(playerRanking(fresh, fresh.players[1]), null); // No silent mixing of prior and current baselines.
  context.rules.scoringType = 'H2H_POINTS';
  assert.equal(playerRanking(context, context.players[1]).fitScore, null);
});

test('cache shares concurrent refreshes, persists cooldowns, and retains prior data after failure or an empty replacement', async () => {
  let time = at.getTime(), record = null, calls = 0, fail = false;
  const store = createRankingsStore({ now: () => time, read: async () => record,
    write: async (seasonId, changes) => { record = { ...record, seasonId, ...changes }; return record; },
    collect: async () => { calls++; if (fail) throw new Error('Source outage'); return saved().data; } });
  const [first, second] = await Promise.all([store(2027, { refresh: true }), store(2027, { refresh: true })]);
  assert.equal(calls, 1); assert.deepEqual(first, second);
  await store(2027, { refresh: true, force: true }); assert.equal(calls, 1);
  time += 60 * 60 * 1000;
  await store(2027, { refresh: true }); assert.equal(calls, 1);
  time += SIX_HOURS; fail = true;
  const fallback = await store(2027, { refresh: true });
  assert.equal(calls, 2); assert.deepEqual(fallback.data, first.data); assert.match(fallback.lastError, /retained/);
  await store(2027, { refresh: true }); assert.equal(calls, 2);
  time += SIX_HOURS;
  const emptyStore = createRankingsStore({ now: () => time, read: async () => record,
    write: async (seasonId, changes) => { record = { ...record, ...changes }; return record; }, collect: async () => saved([]).data });
  const retained = await emptyStore(2027, { refresh: true });
  assert.equal(retained.data.datasets[1].players.length, 1);
  assert.match(retained.lastError, /retained/);
});
