const fs = require('fs/promises');
const { ProfileStore } = require('../scraper/profiles');
const { launchBrowser } = require('../scraper/browser');
const { assertAuthenticated } = require('../scraper/auth');
const { AdvisorError } = require('./errors');

// ESPN's basketball stat identifiers. Unknown identifiers remain explicitly named.
const STAT_NAMES = { 0: 'PTS', 1: 'BLK', 2: 'STL', 3: 'AST', 4: 'OREB', 5: 'DREB', 6: 'REB',
  11: 'TO', 13: 'FGM', 14: 'FGA', 15: 'FTM', 16: 'FTA', 17: '3PM', 18: '3PA',
  19: 'FG%', 20: 'FT%', 21: '3P%', 23: 'FG missed', 24: 'FT missed', 25: '3P missed',
  26: 'APG', 27: 'BPG', 28: 'MPG', 29: 'PPG', 30: 'RPG', 31: 'SPG', 32: 'TOPG',
  33: '3PM per game', 34: 'PTS per minute', 35: 'AST/TO', 36: 'STL/TO',
  37: 'Double doubles', 38: 'Triple doubles', 40: 'MIN', 41: 'GS', 42: 'GP' };
const SLOTS = { 0: 'PG', 1: 'SG', 2: 'SF', 3: 'PF', 4: 'C', 5: 'G', 6: 'F',
  7: 'G/F', 8: 'F/C', 9: 'G/F/C', 10: 'UTIL', 11: 'UTIL', 12: 'Bench', 13: 'IR', 14: 'IR+' };
const statName = id => STAT_NAMES[id] || `ESPN stat ${id}`;
const namedStats = stats => Object.fromEntries(Object.entries(stats || {}).filter(([, value]) => Number.isFinite(value))
  .map(([id, value]) => [statName(id), Number(value.toFixed(5))]));

function normalizeSnapshot(league, pool, expected) {
  if (String(league.id) !== String(expected.leagueId) || league.seasonId !== expected.seasonId
    || league.settings?.name?.trim().toLowerCase() !== expected.leagueName.toLowerCase()
    || !Array.isArray(league.teams) || league.teams.length !== league.settings.size) {
    throw new AdvisorError('INCOMPLETE_ADVISOR_DATA', 'ESPN returned an unexpected league or incomplete team list.', 502);
  }
  const roster = new Map();
  const teams = league.teams.map(team => {
    if (!Array.isArray(team.roster?.entries)) throw new AdvisorError('INCOMPLETE_ADVISOR_DATA', 'A team roster was missing.', 502);
    const playerIds = team.roster.entries.map(entry => {
      const id = String(entry.playerId);
      if (roster.has(id)) throw new AdvisorError('INCONSISTENT_ROSTERS', 'ESPN rosters changed during refresh. Please retry.', 502);
      roster.set(id, { teamId: String(team.id), lineupSlot: SLOTS[entry.lineupSlotId] || String(entry.lineupSlotId) });
      return id;
    });
    return { id: String(team.id), name: team.name || `${team.location} ${team.nickname}`.trim(),
      playerIds, waiverRank: team.waiverRank, record: team.record?.overall };
  });
  const ids = new Set(pool.map(p => String(p.id)));
  if (ids.size !== pool.length || [...roster.keys()].some(id => !ids.has(id))) {
    throw new AdvisorError('INCOMPLETE_ADVISOR_DATA', 'Some rostered players were missing from ESPN. Please retry.', 502);
  }
  const players = pool.map(entry => {
    const p = entry.player;
    const assigned = roster.get(String(entry.id));
    if (!p?.fullName || (assigned ? String(entry.onTeamId) !== assigned.teamId : Number(entry.onTeamId) > 0)) {
      throw new AdvisorError('INCONSISTENT_ROSTERS', 'ESPN rosters changed during refresh. Please retry.', 502);
    }
    const statistics = (p.stats || []).filter(s => s.statSplitTypeId !== 5).map(s => ({
      seasonId: s.seasonId, source: s.statSourceId === 1 ? 'projection' : s.statSourceId === 0 ? 'actual' : `ESPN source ${s.statSourceId}`,
      splitId: s.statSplitTypeId, scoringPeriodId: s.scoringPeriodId,
      totals: namedStats(s.stats), perGame: namedStats(s.averageStats),
      fantasyPoints: s.appliedTotal, fantasyPointsPerGame: s.appliedAverage
    }));
    return { id: String(entry.id), name: p.fullName, teamId: assigned?.teamId || null,
      lineupSlot: assigned?.lineupSlot || null, status: assigned ? 'ONTEAM' : entry.status,
      eligibleSlots: (p.eligibleSlots || []).map(id => SLOTS[id] || String(id)), proTeamId: p.proTeamId,
      injuryStatus: p.injuryStatus || 'UNKNOWN', droppable: p.droppable,
      percentOwned: p.ownership?.percentOwned, waiverProcessAt: entry.waiverProcessDate || null, statistics };
  });
  const settings = league.settings;
  return { leagueName: expected.leagueName, leagueId: String(league.id), sport: 'basketball',
    seasonId: league.seasonId, updatedAt: new Date(), data: {
      playerPoolComplete: true, scoringPeriodId: league.scoringPeriodId, teams, players,
      rules: { scoringType: settings.scoringSettings.scoringType,
        scoringCategories: settings.scoringSettings.scoringItems.map(item => ({ name: statName(item.statId),
          points: item.points, lowerIsBetter: item.isReverseItem || ['TO', 'FG missed', 'FT missed'].includes(statName(item.statId)) })),
        roster: { ...settings.rosterSettings, lineupSlotCounts: Object.fromEntries(Object.entries(settings.rosterSettings.lineupSlotCounts || {}).map(([id, count]) => [SLOTS[id] || id, count])) },
        acquisition: settings.acquisitionSettings, trades: settings.tradeSettings,
        schedule: settings.scheduleSettings }
    } };
}

async function readJson(page, url, filter) {
  const result = await page.evaluate(async ({ url, filter }) => {
    const response = await fetch(url, { credentials: 'include', signal: AbortSignal.timeout(30000),
      headers: filter ? { 'x-fantasy-filter': JSON.stringify(filter) } : {} });
    return { status: response.status, count: response.headers.get('x-fantasy-filter-player-count'),
      data: response.ok ? await response.json() : null };
  }, { url, filter });
  if ([401, 403].includes(result.status)) throw new AdvisorError('ESPN_REAUTH_REQUIRED', 'The saved ESPN login needs to be renewed.', 401);
  if (result.status !== 200) throw new AdvisorError('ESPN_DATA_UNAVAILABLE', 'ESPN could not return the advisor dataset. Please retry.', 502);
  return result;
}

async function collectAdvisorSnapshot(league, sessionFile = process.env.ESPN_ADVISOR_SESSION_FILE) {
  if (league.sport !== 'basketball') throw new AdvisorError('UNSUPPORTED_ADVISOR_REFRESH', 'Full player-pool refresh currently supports basketball. Saved roster analysis is available for this league.', 400);
  if (!/^\d+$/.test(String(league.leagueId)) || !Number.isInteger(league.seasonId)) {
    throw new AdvisorError('SCRAPE_REQUIRED', 'Run a current league scrape before refreshing advisor data.', 409);
  }
  if (!sessionFile) throw new AdvisorError('ESPN_SESSION_NOT_CONFIGURED', 'Configure ESPN_ADVISOR_SESSION_FILE on the API server to refresh ESPN data.', 503);
  let saved;
  try { saved = JSON.parse(await fs.readFile(sessionFile, 'utf8')); }
  catch { throw new AdvisorError('ESPN_SESSION_NOT_CONFIGURED', 'The configured ESPN session file could not be read.', 503); }
  const profile = await new ProfileStore().open(saved.sessionToken);
  let browser;
  try {
    browser = await launchBrowser({ userDataDir: profile.userDataDir });
    const page = await browser.newPage();
    await assertAuthenticated(page, 'basketball');
    await page.goto(`https://fantasy.espn.com/basketball/team?leagueId=${league.leagueId}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    const base = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/${league.seasonId}/segments/0/leagues/${league.leagueId}`;
    const current = (await readJson(page, `${base}?view=mRoster&view=mSettings&view=mTeam`)).data;
    const players = [];
    let expectedCount;
    // Read the complete pool, including rostered players, waivers and free agents.
    for (let offset = 0; offset < 10000; offset += 200) {
      const result = await readJson(page, `${base}?view=kona_player_info&scoringPeriodId=${current.scoringPeriodId}`, { players: {
        limit: 200, offset, sortPercOwned: { sortPriority: 1, sortAsc: false },
        sortDraftRanks: { sortPriority: 100, sortAsc: true, value: 'STANDARD' },
        filterStatsForTopScoringPeriodIds: { value: 1, additionalValue: [
          `00${league.seasonId}`, `10${league.seasonId}`, `00${league.seasonId - 1}`,
          `01${league.seasonId}`, `02${league.seasonId}`, `03${league.seasonId}`] }
      } });
      const count = result.count === null ? NaN : Number(result.count);
      if (!Number.isInteger(count) || count < 1 || !Array.isArray(result.data.players)
        || (expectedCount !== undefined && expectedCount !== count)) {
        throw new AdvisorError('INCOMPLETE_ADVISOR_DATA', 'ESPN did not return a complete, stable player pool. Please retry.', 502);
      }
      expectedCount = count;
      players.push(...result.data.players);
      if (players.length === expectedCount) break;
      if (players.length > expectedCount || result.data.players.length !== 200) break;
    }
    if (players.length !== expectedCount) throw new AdvisorError('INCOMPLETE_ADVISOR_DATA', 'The ESPN player pool was truncated. Previous data was preserved.', 502);
    return normalizeSnapshot(current, players, league);
  } finally {
    if (browser) await browser.close().catch(() => {});
    profile.release();
  }
}
module.exports = { collectAdvisorSnapshot, normalizeSnapshot, namedStats };
