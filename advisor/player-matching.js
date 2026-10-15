const normalize = name => name.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]/g, '');
// Explicit cross-provider name variants; never use fuzzy surname matching.
const aliases = { nicolasclaxton: 'nicclaxton', herbjones: 'herbertjones', alexandresarr: 'alexsarr' };
const baseName = name => { const key = normalize(name.replace(/\s+(jr\.?|sr\.?|ii|iii|iv)$/i, '')); return aliases[key] || key; };
function uniqueIndex(players, key) {
  const map = new Map();
  for (const p of players) { const name = key(p.name); map.set(name, map.has(name) ? null : p); }
  return map;
}

function matchPlayers(players, sourcePlayers) {
  const map = new Map();
  const exact = uniqueIndex(sourcePlayers, normalize), base = uniqueIndex(sourcePlayers, baseName);
  const leagueExact = uniqueIndex(players, normalize), leagueBase = uniqueIndex(players, baseName);
  for (const player of players) {
    const key = normalize(player.name), short = baseName(player.name);
    const match = leagueExact.get(key) && exact.get(key) || leagueBase.get(short) && base.get(short);
    if (match) map.set(player.id, match);
  }
  return map;
}

module.exports = { matchPlayers, normalize, baseName };
