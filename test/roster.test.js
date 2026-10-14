const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { launchBrowser } = require('../scraper/browser');
const { readRosterTables, readRenderedRoster, normalizePlayers, completeSnapshot } = require('../scraper/roster');

let browser;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });

const target = { leagueName: 'Fixture', leagueId: '123', sport: 'hockey', statsPeriod: 'currSeason' };
function section(type, position, names, rows) {
  return `<div class="players-table"><table class="Table--fixed-left"><thead><tr><th>${type}</th></tr></thead><tbody>
    ${rows.map((row, i) => `<tr data-idx="${i}"><td>${row.slot || position}</td><td>${row.name ? `<div class="player-column__athlete" title="${row.name}"></div><span class="playerinfo__playerpos">${position}</span>` : 'Empty'}</td></tr>`).join('')}
    </tbody></table><div class="Table__Scroller"><table><thead><tr><th colspan="${names.length}">2027 SEASON</th><th colspan="2">RESEARCH</th></tr><tr>${[...names, '%ROST', '+/-'].map(name => `<th>${name}</th>`).join('')}</tr></thead><tbody>
    ${rows.map((row, i) => `<tr data-idx="${i}">${[...row.stats, '99', '-0.3'].map(value => `<td>${value}</td>`).join('')}</tr>`).join('')}
    </tbody></table></div><table class="Table--fixed-right"><thead><tr><th>FANTASY PTS</th></tr><tr><th>TOT</th></tr></thead><tbody>
    ${rows.map((row, i) => `<tr data-idx="${i}"><td>${row.points}</td></tr>`).join('')}
    </tbody></table></div>`;
}

test('hockey reads both sections, keeps zeros, excludes research, and aligns skaters and goalies', async () => {
  const page = await browser.newPage();
  try {
    await page.setContent(section('SKATERS', 'F', ['GP', 'G', 'A'], [
      { name: 'Skater', stats: [2, 0, 3], points: '6.3' },
      { name: 'Reserve', slot: 'IR', stats: [4, 2, 8], points: '20' },
      { stats: ['--', '--', '--'], points: '--' }
    ]) + section('GOALIES', 'G', ['GS', 'W', 'GA', 'SV', 'SO'], [
      { name: 'Goalie', slot: 'Bench', stats: [2, 1, 4, 50, 0], points: '5.25' }
    ]));
    const players = normalizePlayers(await page.evaluate(readRenderedRoster), 'hockey');
    const league = completeSnapshot([{ teamName: 'Alpha', players }], target, 2027);
    const stats = Object.fromEntries(league.teams[0].catAvg.map(stat => [stat.name, stat.number]));
    assert.deepEqual(stats, { G: 0, A: 3, FPTS: 11.55, W: 1, GA: 4, SV: 50, SO: 0 });
    assert.equal(league.scoringType, 'points');
    assert.equal(league.seasonId, 2027);
    assert.equal(players.length, 3);
    assert.equal(players[2].position, 'G');
    assert.equal(players[2].lineupSlot, 'Bench');
    assert.equal(players[2].categories.find(stat => stat.name === 'GA').lowerIsBetter, true);
    assert.deepEqual(players[0].categories.map(stat => stat.name), players[2].categories.map(stat => stat.name));
    await page.evaluate(() => document.querySelector('.Table__Scroller tbody tr').remove());
    await assert.rejects(page.evaluate(readRenderedRoster), /incomplete/);
  } finally { await page.close(); }
});

test('basketball shooting uses made/attempted weights and preserves zero categories', () => {
  const players = normalizePlayers([{ players: [
    { name: 'A', values: [{ name: 'FGM', value: '1/2' }, { name: 'TO', value: '0' }] },
    { name: 'B', values: [{ name: 'FGM/FGA', value: '1/8' }, { name: 'TO', value: '0' }] }
  ] }]);
  const league = completeSnapshot([{ teamName: 'A', players }], { ...target, sport: 'basketball' }, 2027);
  assert.deepEqual(Object.fromEntries(league.catAvg.map(stat => [stat.name, stat.number])), { FGM: 2, FGA: 10, 'FG%': 0.2, TO: 0 });
});

test('missing goalie tables and unreadable stats are rejected before saving', () => {
  assert.throws(() => normalizePlayers([{ type: 'SKATERS', players: [] }], 'hockey'), { code: 'INCOMPLETE_ROSTER' });
  assert.throws(() => normalizePlayers([{ players: [{ values: [{ name: 'G', value: 'unavailable' }] }] }]), { code: 'INVALID_STATISTICS' });
});

test('projection scrape matches team links with extra whitespace and nonconsecutive IDs', async () => {
  const page = await browser.newPage();
  const visited = [];
  const standings = `<nav class="NavSecondary">
    <a href="/basketball/team?leagueId=123&teamId=1">My Team</a>
    <a href="/basketball/team?leagueId=123&teamId=8">Jerry West  (JW)Manager</a>
    <a href="/basketball/team?leagueId=123&teamId=13">Luck&nbsp; Not Skill  (LNS)Manager</a>
    </nav><div class="season--stats--table"><table class="Table--fixed-left"><tbody>
    <tr><td class="teamName">Own Team</td></tr>
    <tr><td class="teamName">Jerry West </td></tr>
    <tr><td class="teamName">Luck Not Skill </td></tr>
    </tbody></table></div>`;
  try {
    await page.setRequestInterception(true);
    page.on('request', request => {
      if (request.resourceType() !== 'document') {
        request.respond({ status: 204 });
        return;
      }
      const url = new URL(request.url());
      const isStandings = url.pathname.endsWith('/standings');
      if (!isStandings) visited.push({ teamId: url.searchParams.get('teamId'), period: url.searchParams.get('statSplit') });
      const roster = `<select id="filterStat"><option value="currSeason">2027 Season</option>
        <option value="projections" selected>2027 Projections</option></select>`
        + section('PLAYERS', 'PG', ['PTS'], [{ name: 'Player', stats: [20], points: 20 }])
          .replace('2027 SEASON', 'STATS');
      request.respond({ status: 200, contentType: 'text/html', body: isStandings ? standings : roster });
    });
    const league = await readRosterTables(page, { ...target, sport: 'basketball', statsPeriod: 'projections' });
    assert.deepEqual(visited, ['1', '8', '13'].map(teamId => ({ teamId, period: 'projections' })));
    assert.deepEqual(league.teams.map(team => team.teamId), ['1', '8', '13']);
    assert.equal(league.seasonId, 2027);
    assert.equal(league.statsPeriod, 'projections');
    assert.equal(league.teams.length, 3);
  } finally { await page.close(); }
});
