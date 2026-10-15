const { CATEGORY_COLUMNS } = require('./basketball-monster');
const { SIX_HOURS } = require('./rankings-store');

const normalize = name => name.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]/g, '');
// Explicit cross-provider name variants; never use fuzzy surname matching.
const aliases = { nicolasclaxton: 'nicclaxton', herbjones: 'herbertjones', alexandresarr: 'alexsarr' };
const baseName = name => { const key = normalize(name.replace(/\s+(jr\.?|sr\.?|ii|iii|iv)$/i, '')); return aliases[key] || key; };
function uniqueIndex(players, key) {
  const map = new Map();
  for (const p of players) { const name = key(p.name); map.set(name, map.has(name) ? null : p); }
  return map;
}

function attachRankings(context, saved, now = new Date()) {
  if (context.metadata.sport !== 'basketball') return context;
  const year = context.metadata.seasonId;
  const current = saved?.data?.datasets?.find(d => d.seasonId === year);
  const previous = saved?.data?.datasets?.find(d => d.seasonId === year - 1);
  const dataset = current?.players?.length ? current : previous?.players?.length ? previous : null;
  const map = new Map();
  if (dataset) {
    const exact = uniqueIndex(dataset.players, p => normalize(p)), base = uniqueIndex(dataset.players, baseName);
    const leagueExact = uniqueIndex(context.players, p => normalize(p)), leagueBase = uniqueIndex(context.players, baseName);
    for (const player of context.players) {
      const key = normalize(player.name), short = baseName(player.name);
      const match = leagueExact.get(key) && exact.get(key) || leagueBase.get(short) && base.get(short);
      if (match) map.set(player.id, match);
    }
  }
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
