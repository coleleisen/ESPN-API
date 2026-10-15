const { AdvisorError } = require('./errors');
const { playerRanking } = require('./ranking-context');
const { CATEGORY_COLUMNS } = require('./basketball-monster');

const categoryValues = categories => Object.fromEntries((categories || []).map(c => [c.name,
  c.number !== '' && c.number != null && Number.isFinite(Number(c.number)) ? Number(c.number) : null]));

function selectStatistics(player, period, seasonId) {
  const source = period === 'projections' ? 'projection' : 'actual';
  const year = period === 'previous' ? seasonId - 1 : seasonId;
  const split = { last7: 1, last15: 2, last30: 3 }[period] || 0;
  return player.statistics.find(s => s.source === source && s.seasonId === year && s.splitId === split) || null;
}

function buildContext(league, snapshot, now = new Date()) {
  const enriched = snapshot && snapshot.seasonId === league.seasonId && snapshot.leagueId === league.leagueId;
  const warnings = [];
  const asOf = enriched ? snapshot.updatedAt : league.lastUpdate;
  if (!asOf || now - new Date(asOf) > 6 * 60 * 60 * 1000) warnings.push('League data is over six hours old or its age is unknown. Refresh before acting on player availability.');
  if (!enriched) warnings.push('The full ESPN player pool and league rules have not been synced. Waiver availability cannot be verified.');
  if (enriched && new Date(league.lastUpdate) > new Date(snapshot.updatedAt)) warnings.push('The dashboard has a newer roster scrape. Refresh advisor data to synchronize ownership.');
  const teams = enriched ? snapshot.data.teams : league.teams.map((t, i) => ({ id: String(t.teamId || `saved-${i}`), name: t.teamName,
    playerIds: t.players.map((p, j) => String(p.playerId || `saved-${i}-${j}`)), savedRosterTotals: categoryValues(t.catAvg) }));
  const players = enriched ? snapshot.data.players : league.teams.flatMap((t, i) => t.players.map((p, j) => ({
    id: String(p.playerId || `saved-${i}-${j}`), name: p.name, teamId: teams[i].id, status: 'ONTEAM',
    lineupSlot: p.lineupSlot, eligibleSlots: [p.position].filter(Boolean),
    injuryStatus: 'UNKNOWN', inIRSlot: p.injured,
    savedStatistics: { period: league.statsPeriod || 'unknown', values: categoryValues(p.categories), units: 'As displayed in the saved ESPN roster table; not necessarily season totals.' }, statistics: []
  })));
  const metadata = { league: league.leagueName, sport: league.sport, seasonId: league.seasonId,
    asOf, currentTime: now.toISOString(), playerPoolComplete: Boolean(enriched && snapshot.data.playerPoolComplete),
    teamCount: teams.length, rosteredPlayers: players.filter(p => p.teamId).length,
    availablePlayers: enriched ? players.filter(p => !p.teamId && ['FREEAGENT', 'WAIVERS'].includes(p.status)).length : null,
    warnings };
  const rules = enriched ? snapshot.data.rules : { scoringType: league.scoringType || 'unknown',
    savedCategories: (league.catAvg || []).map(c => ({ name: c.name, lowerIsBetter: c.lowerIsBetter })) };
  return { metadata, rules, teams, players, initial: { metadata, rules,
    // Ownership is cheap to send. Detailed statistics stay in the lookup pool.
    rosterColumns: ['id', 'name'],
    teams: teams.map(t => ({ id: t.id, name: t.name, waiverRank: t.waiverRank,
      roster: players.filter(p => p.teamId === t.id).map(p => [p.id, p.name]) })) } };
}

const round = value => Number.isFinite(value) ? Number(value.toFixed(3)) : null;
const categoriesFor = context => (context.rules.scoringCategories || context.rules.savedCategories || []).map(c => c.name);
const statColumnsFor = context => [...new Set([...categoriesFor(context),
  ...(context.metadata.sport === 'basketball' ? ['FGM', 'FGA', 'FTM', 'FTA', 'MIN'] : [])])];
function statsFor(player, period, seasonId) {
  const s = selectStatistics(player, period, seasonId);
  return s ? { ...s.perGame, ...(Object.keys(s.perGame || {}).length && Number.isFinite(s.fantasyPointsPerGame) ? { FPTS: s.fantasyPointsPerGame } : {}) } : {};
}
function teamSummary(context, team, period, columns) {
  const players = context.players.filter(p => p.teamId === team.id && !['IR', 'IR+'].includes(p.lineupSlot));
  const stats = players.map(p => statsFor(p, period, context.metadata.seasonId));
  const coverage = [];
  const values = columns.map(category => {
    const ratio = { 'FG%': ['FGM', 'FGA'], 'FT%': ['FTM', 'FTA'], '3P%': ['3PM', '3PA'] }[category];
    const available = stats.filter(s => ratio ? ratio.every(k => Number.isFinite(s[k])) : Number.isFinite(s[category]));
    coverage.push(available.length);
    if (!available.length || (!ratio && /%|GAA/.test(category))) return null;
    if (ratio) {
      const attempts = available.reduce((sum, s) => sum + s[ratio[1]], 0);
      return attempts ? round(available.reduce((sum, s) => sum + s[ratio[0]], 0) / attempts) : null;
    }
    return round(available.reduce((sum, s) => sum + s[category], 0));
  });
  return { teamId: team.id, players: players.length, values, coverage };
}

function promptContext(context, teamId) {
  // Keep the clock outside this reusable prefix so unrelated chat turns can
  // reuse cached league context. Freshness warnings are sent separately.
  const { currentTime, warnings, ...metadata } = context.metadata;
  const columns = statColumnsFor(context);
  const selected = context.players.filter(p => p.teamId === teamId);
  const table = period => selected.map(p => [p.id, ...columns.map(k => round(statsFor(p, period, metadata.seasonId)[k]))]);
  const categories = categoriesFor(context);
  return { ...context.initial, metadata,
    teamComparison: { columns: categories,
      units: 'Sums of available per-game stats assuming equal games per player, including bench, excluding IR. Percentages are attempt-weighted ratios. Coverage is contributing players per category; null means unavailable. These are not weekly totals or official matchup predictions.',
      projections: context.teams.map(t => teamSummary(context, t, 'projections', categories)),
      current: context.teams.map(t => teamSummary(context, t, 'current', categories)) },
    selectedRoster: teamId ? { teamId, statColumns: ['id', ...columns], units: 'per game; null = unavailable',
      players: selected.map(p => ({ id: p.id, lineupSlot: p.lineupSlot, eligibleSlots: p.eligibleSlots, injuryStatus: p.injuryStatus,
        ...(p.savedStatistics ? { savedStatistics: p.savedStatistics } : {}) })), projections: table('projections'), current: table('current'),
      ...(context.metadata.basketballMonster?.available ? { basketballMonster: {
        columns: ['id', 'rank', 'value', 'games', ...Object.keys(CATEGORY_COLUMNS)],
        rows: selected.map(p => { const rank = playerRanking(context, p); return [p.id, ...(rank
          ? [rank.rank, rank.overallValue, rank.games, ...Object.keys(CATEGORY_COLUMNS).map(c => rank.zScores[c])]
          : Array(12).fill(null))]; }) } } : {}) } : null };
}

const TOOL = {
  type: 'function', name: 'lookup_league_players', strict: true,
  description: 'Search the ENTIRE selected league player pool, including every roster and available players. Returns ownership, waiver status, injury designation and actual/projection stats. Paginate using offset. Use before waiver recommendations. Empty query matches all players; sortBy is an exact stat label such as AST, BLK, PTS, or percentOwned.',
  parameters: { type: 'object', additionalProperties: false, properties: {
    query: { type: 'string', description: 'Case-insensitive substring of a player name; empty for all.' },
    teamId: { type: 'string', description: 'Exact team id, or empty for every team.' },
    availability: { type: 'string', enum: ['all', 'available', 'rostered'] },
    period: { type: 'string', enum: ['projections', 'current', 'previous', 'last7', 'last15', 'last30'] },
    sortBy: { type: 'string', description: 'ESPN per-game stat or percentOwned. BBM_FIT sorts the mean Basketball Monster z-score in league categories excluding excludeCategories; BBM_VALUE uses public overall value; BBM_AST etc. sort a category z-score. BBM values are higher-is-better including TO and may be prior-season actuals; check source metadata.' },
    excludeCategories: { type: 'array', items: { type: 'string', enum: Object.keys(CATEGORY_COLUMNS) }, maxItems: 9, description: 'Punted categories to exclude from BBM_FIT. Empty means all supported league categories.' },
    minGames: { type: 'integer', minimum: 0, maximum: 100, description: 'Minimum games in the BBM source season; 0 applies no sample filter and includes players missing BBM data. Prefer at least 10 for historical ranking searches; lower cautiously early in the season.' },
    ascending: { type: 'boolean' }, offset: { type: 'integer', minimum: 0, maximum: 10000 },
    limit: { type: 'integer', minimum: 1, maximum: 20, description: 'Prefer 5-8 candidates; paginate for more.' },
    detail: { type: 'string', enum: ['scoring', 'all'], description: 'scoring returns scoring-category averages and shooting weights. all retrieves every saved stat and totals for the requested period.' }
  }, required: ['query', 'teamId', 'availability', 'period', 'sortBy', 'ascending', 'excludeCategories', 'minGames', 'offset', 'limit', 'detail'] }
};

function lookupPlayers(context, args) {
  if (!args || typeof args.query !== 'string' || typeof args.teamId !== 'string' || typeof args.sortBy !== 'string'
    || typeof args.ascending !== 'boolean' || !['all', 'available', 'rostered'].includes(args.availability)
    || !['projections', 'current', 'previous', 'last7', 'last15', 'last30'].includes(args.period)
    || !Number.isInteger(args.offset) || args.offset < 0 || args.offset > 10000
    || !Number.isInteger(args.limit) || args.limit < 1 || args.limit > 20
    || (args.detail !== undefined && !['scoring', 'all'].includes(args.detail))
    || (args.excludeCategories !== undefined && (!Array.isArray(args.excludeCategories) || args.excludeCategories.length > 9 || args.excludeCategories.some(c => !Object.hasOwn(CATEGORY_COLUMNS, c))))
    || (args.minGames !== undefined && (!Number.isInteger(args.minGames) || args.minGames < 0 || args.minGames > 100))) {
    throw new AdvisorError('INVALID_TOOL_ARGUMENTS', 'Invalid player lookup parameters.', 400);
  }
  if (args.availability === 'available' && !context.metadata.playerPoolComplete) {
    return { error: 'Waiver data is not synced. Do not infer availability from web search or missing roster names.' };
  }
  const ranking = player => playerRanking(context, player, args.excludeCategories || []);
  if (args.sortBy.startsWith('BBM_') && !context.metadata.basketballMonster?.available) {
    return { error: 'Basketball Monster rankings are unavailable. Use ESPN statistics and disclose the missing ranking data.' };
  }
  let players = context.players.filter(p => p.name.toLowerCase().includes(args.query.toLowerCase())
    && (!args.teamId || p.teamId === args.teamId)
    && (!(args.minGames > 0) || ranking(p)?.games >= args.minGames)
    && (args.availability === 'all' || (args.availability === 'rostered' ? Boolean(p.teamId) : !p.teamId && ['FREEAGENT', 'WAIVERS'].includes(p.status))));
  const value = player => {
    if (args.sortBy.startsWith('BBM_')) {
      const row = ranking(player);
      return args.sortBy === 'BBM_FIT' ? row?.fitScore : args.sortBy === 'BBM_VALUE' ? row?.overallValue : row?.zScores[args.sortBy.slice(4)];
    }
    return args.sortBy && args.sortBy !== 'percentOwned' ? statsFor(player, args.period, context.metadata.seasonId)[args.sortBy] : player.percentOwned;
  };
  players = players.sort((a, b) => {
    const av = value(a), bv = value(b);
    if (av == null && bv == null) return a.name.localeCompare(b.name);
    if (av == null) return 1;
    if (bv == null) return -1;
    return (args.ascending ? av - bv : bv - av) || a.name.localeCompare(b.name);
  });
  const columns = new Set([...statColumnsFor(context), args.sortBy]);
  const resultPlayers = players.slice(args.offset, args.offset + args.limit).map(p => {
    const selected = selectStatistics(p, args.period, context.metadata.seasonId);
    const statistics = !selected ? null : args.detail === 'all' ? selected : {
      seasonId: selected.seasonId, source: selected.source, splitId: selected.splitId,
      perGame: Object.fromEntries(Object.entries(statsFor(p, args.period, context.metadata.seasonId)).filter(([k]) => columns.has(k)).map(([k, v]) => [k, round(v)]))
    };
    return { id: p.id, name: p.name, teamId: p.teamId, status: p.status, lineupSlot: p.lineupSlot,
      eligibleSlots: p.eligibleSlots, injuryStatus: p.injuryStatus, percentOwned: round(p.percentOwned),
      waiverProcessAt: p.waiverProcessAt, savedStatistics: p.savedStatistics, statistics,
      ...(context.metadata.basketballMonster ? { basketballMonster: ranking(p) } : {}) };
  });
  // Bound a result without losing access to later candidates: nextOffset uses
  // the actual returned count, and callers can request a later page.
  while (resultPlayers.length > 1 && Buffer.byteLength(JSON.stringify(resultPlayers)) > 10000) resultPlayers.pop();
  return { asOf: context.metadata.asOf, total: players.length, offset: args.offset,
    nextOffset: args.offset + resultPlayers.length < players.length ? args.offset + resultPlayers.length : null,
    period: args.period, statsUnits: 'totals = period totals; perGame = ESPN per-game averages; missing or empty statistics mean unavailable, not zero.',
    ...(context.metadata.basketballMonster ? { basketballMonster: context.metadata.basketballMonster,
      fitScoreMethod: 'Mean of the supplied public category z-scores in fitCategories; app-computed, not an official BBM punt ranking or win probability. Positive TO z-score is already favorable. Compare only within this source season/basis.' } : {}), players: resultPlayers };
}
module.exports = { buildContext, promptContext, lookupPlayers, selectStatistics, TOOL };
