const { AdvisorError } = require('./errors');

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
  const summary = player => ({ id: player.id, name: player.name, teamId: player.teamId, status: player.status,
    lineupSlot: player.lineupSlot, eligibleSlots: player.eligibleSlots, injuryStatus: player.injuryStatus,
    savedStatistics: player.savedStatistics,
    projections: selectStatistics(player, 'projections', league.seasonId)?.perGame || null,
    current: selectStatistics(player, 'current', league.seasonId)?.perGame || null });
  return { metadata, rules, teams, players, initial: { metadata, rules,
    teams: teams.map(t => ({ ...t, players: players.filter(p => p.teamId === t.id).map(summary) })) } };
}

const TOOL = {
  type: 'function', name: 'lookup_league_players', strict: true,
  description: 'Search the ENTIRE selected league player pool, including every roster and available players. Returns ownership, waiver status, injury designation and actual/projection stats. Paginate using offset. Use before waiver recommendations. Empty query matches all players; sortBy is an exact stat label such as AST, BLK, PTS, or percentOwned.',
  parameters: { type: 'object', additionalProperties: false, properties: {
    query: { type: 'string', description: 'Case-insensitive substring of a player name; empty for all.' },
    teamId: { type: 'string', description: 'Exact team id, or empty for every team.' },
    availability: { type: 'string', enum: ['all', 'available', 'rostered'] },
    period: { type: 'string', enum: ['projections', 'current', 'previous', 'last7', 'last15', 'last30'] },
    sortBy: { type: 'string', description: 'Per-game statistic label, or percentOwned. Empty sorts by percentOwned.' },
    ascending: { type: 'boolean' }, offset: { type: 'integer', minimum: 0, maximum: 10000 },
    limit: { type: 'integer', minimum: 1, maximum: 30 }
  }, required: ['query', 'teamId', 'availability', 'period', 'sortBy', 'ascending', 'offset', 'limit'] }
};

function lookupPlayers(context, args) {
  if (!args || typeof args.query !== 'string' || typeof args.teamId !== 'string' || typeof args.sortBy !== 'string'
    || typeof args.ascending !== 'boolean' || !['all', 'available', 'rostered'].includes(args.availability)
    || !['projections', 'current', 'previous', 'last7', 'last15', 'last30'].includes(args.period)
    || !Number.isInteger(args.offset) || args.offset < 0 || args.offset > 10000
    || !Number.isInteger(args.limit) || args.limit < 1 || args.limit > 30) {
    throw new AdvisorError('INVALID_TOOL_ARGUMENTS', 'Invalid player lookup parameters.', 400);
  }
  if (args.availability === 'available' && !context.metadata.playerPoolComplete) {
    return { error: 'Waiver data is not synced. Do not infer availability from web search or missing roster names.' };
  }
  let players = context.players.filter(p => p.name.toLowerCase().includes(args.query.toLowerCase())
    && (!args.teamId || p.teamId === args.teamId)
    && (args.availability === 'all' || (args.availability === 'rostered' ? Boolean(p.teamId) : !p.teamId && ['FREEAGENT', 'WAIVERS'].includes(p.status))));
  const value = player => args.sortBy && args.sortBy !== 'percentOwned'
    ? selectStatistics(player, args.period, context.metadata.seasonId)?.perGame?.[args.sortBy]
    : player.percentOwned;
  players = players.sort((a, b) => {
    const av = value(a), bv = value(b);
    if (av == null && bv == null) return a.name.localeCompare(b.name);
    if (av == null) return 1;
    if (bv == null) return -1;
    return (args.ascending ? av - bv : bv - av) || a.name.localeCompare(b.name);
  });
  return { asOf: context.metadata.asOf, total: players.length, offset: args.offset,
    nextOffset: args.offset + args.limit < players.length ? args.offset + args.limit : null,
    period: args.period, statsUnits: 'totals = period totals; perGame = ESPN per-game averages; missing or empty statistics mean unavailable, not zero.',
    players: players.slice(args.offset, args.offset + args.limit).map(({ statistics, ...p }) => ({ ...p,
      statistics: selectStatistics({ statistics }, args.period, context.metadata.seasonId) })) };
}
module.exports = { buildContext, lookupPlayers, selectStatistics, TOOL };
