const { CATEGORY_COLUMNS } = require('./basketball-monster');
const { SIX_HOURS } = require('./public-cache');
const { matchPlayers, normalize, baseName } = require('./player-matching');

function attachRankings(context, saved, now = new Date()) {
  if (context.metadata.sport !== 'basketball') return context;
  const year = context.metadata.seasonId;
  const current = saved?.data?.datasets?.find(d => d.seasonId === year);
  const previous = saved?.data?.datasets?.find(d => d.seasonId === year - 1);
  const dataset = current?.players?.length ? current : previous?.players?.length ? previous : null;
  const map = dataset ? matchPlayers(context.players, dataset.players) : new Map();
  const warnings = [];
  if (saved?.lastError) warnings.push(saved.lastError);
  if (!current?.players?.length) warnings.push('Current-season public rankings are unavailable. Prior-season results, when present, are historical evidence, not projections.');
  if (dataset && now - new Date(dataset.fetchedAt) > SIX_HOURS) warnings.push('Basketball Monster rankings were retrieved over six hours ago.');
  const metadata = { source: 'Basketball Monster', sourceUrl: dataset?.sourceUrl || 'https://basketballmonster.com/playerrankings.aspx',
    available: Boolean(dataset), requestedSeasonId: year, seasonId: dataset?.seasonId || null,
    currentSeasonAvailable: Boolean(current?.players?.length), checkedAt: saved?.data?.checkedAt || null,
    fetchedAt: dataset?.fetchedAt || null, kind: 'actual', period: 'full season', basis: 'per game',
    settings: dataset?.settings || 'Public standard nine-category values, no punts.',
    rankedPlayers: dataset?.players?.length || 0, matchedPlayers: map.size, warnings };
  return { ...context, metadata: { ...context.metadata, basketballMonster: metadata }, bbmByPlayerId: map };
}

function fitCategories(context, exclude = []) {
  if (/POINT/i.test(context.rules.scoringType || '')) return [];
  return [...new Set((context.rules.scoringCategories || context.rules.savedCategories || []).map(c => c.name))]
    .filter(c => Object.hasOwn(CATEGORY_COLUMNS, c) && !exclude.includes(c));
}

function playerRanking(context, player, exclude = []) {
  const source = context.bbmByPlayerId?.get(player.id);
  if (!source) return null;
  const categories = fitCategories(context, exclude);
  const score = categories.length && categories.every(c => Number.isFinite(source.zScores[c]))
    ? Number((categories.reduce((sum, c) => sum + source.zScores[c], 0) / categories.length).toFixed(3)) : null;
  return { sourcePlayerId: source.id, rank: source.rank, overallValue: source.overallValue, games: source.games,
    zScores: source.zScores, fitScore: score, fitCategories: categories };
}

module.exports = { attachRankings, playerRanking, fitCategories, normalize, baseName };
