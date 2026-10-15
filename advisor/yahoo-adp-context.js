const { matchPlayers } = require('./player-matching');
const { SIX_HOURS } = require('./public-cache');
const { SOURCE } = require('./yahoo-adp');

function attachYahooAdp(context, saved, now = new Date()) {
  if (context.metadata.sport !== 'basketball') return context;
  const year = context.metadata.seasonId;
  // Never fall back to a previous season, even if a saved record is mis-keyed.
  const dataset = saved?.data?.seasonId === year && saved.data.yahooSeason === year - 1 && saved.data.players?.length ? saved.data : null;
  const map = dataset ? matchPlayers(context.players, dataset.players) : new Map();
  const warnings = [];
  if (saved?.lastError) warnings.push(saved.lastError);
  if (!dataset) warnings.push('Current-season Yahoo ADP is unavailable. No prior-season Yahoo values are used.');
  if (dataset && now - new Date(dataset.fetchedAt) > SIX_HOURS) warnings.push('Yahoo ADP was retrieved over six hours ago.');
  const metadata = { source: 'Yahoo Fantasy Basketball', sourceUrl: SOURCE, available: Boolean(dataset),
    requestedSeasonId: year, seasonId: dataset?.seasonId || null, fetchedAt: dataset?.fetchedAt || null,
    kind: 'draft market value', basis: 'All drafts; standard scoring settings',
    rankedPlayers: dataset?.players?.length || 0, matchedPlayers: map.size, warnings };
  return { ...context, metadata: { ...context.metadata, yahooAdp: metadata }, yahooAdpByPlayerId: map };
}

function playerAdp(context, player) {
  const row = context.yahooAdpByPlayerId?.get(player.id);
  return row ? { adp: row.adp, percentDrafted: row.percentDrafted } : null;
}

module.exports = { attachYahooAdp, playerAdp };
