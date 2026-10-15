const { load } = require('cheerio');

const SOURCE = 'https://basketball.fantasysports.yahoo.com/nba/draftanalysis?type=standard';
const API = 'https://pub-api-ro.fantasysports.yahoo.com/fantasy/v2';
const PAGE_SIZE = 100;

function discoverGameId(html) {
  const $ = load(html);
  const scripts = $('script').toArray().map(e => $(e).html() || '').filter(s => s.includes('bootstrapFantasyStatTable'));
  if (scripts.length !== 1 || !/var\s+sportCode\s*=\s*"nba"\s*;/.test(scripts[0])
    || !/var\s+type\s*=\s*"standard"\s*;/.test(scripts[0])) throw new Error('Yahoo public draft settings could not be verified.');
  const id = scripts[0].match(/var\s+gameId\s*=\s*"(\d+)"\s*;/)?.[1];
  if (!id) throw new Error('Yahoo current game ID is unavailable.');
  return id;
}

function numeric(value, max, { positive = false } = {}) {
  if (value == null || ['', '-'].includes(value)) return null;
  if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(String(value))) throw new Error('Invalid Yahoo ADP value.');
  const number = Number(value);
  if (!Number.isFinite(number) || number > max || (positive && number <= 0)) {
    throw new Error('Invalid Yahoo ADP value.');
  }
  return number;
}

function parseAdpPage(json, seasonId, gameId) {
  const league = json?.fantasy_content?.league;
  // Yahoo labels an NBA season by its starting year; ESPN uses its ending year.
  if (league?.game_code !== 'nba' || String(league.season) !== String(seasonId - 1)
    || !String(league.league_key).startsWith(`${gameId}.l.`)) throw new Error('Yahoo ADP season does not match the current league season.');
  if (!Array.isArray(league.players) || league.players.length > PAGE_SIZE
    || league['players:attributes']?.count !== league.players.length) throw new Error('Incomplete Yahoo ADP page.');
  return league.players.map(entry => {
    const p = entry?.player, id = String(p?.player_id || ''), name = p?.name?.full;
    if (!/^\d+$/.test(id) || p?.player_key !== `${gameId}.p.${id}` || typeof name !== 'string'
      || !name.trim() || name.length > 140 || !p.draft_analysis) throw new Error('Invalid Yahoo player identity or draft data.');
    const adp = numeric(p.draft_analysis.average_pick, 1500, { positive: true });
    const drafted = numeric(p.draft_analysis.percent_drafted, 1);
    return { id, name: name.trim(), adp, percentDrafted: drafted === null ? null : Number((drafted * 100).toFixed(2)) };
  });
}

async function collectYahooAdp(seasonId, { fetchImpl = fetch, now = new Date(), signal = AbortSignal.timeout(25000) } = {}) {
  if (!Number.isInteger(seasonId) || seasonId < 2005 || seasonId > 2100) throw new Error('Invalid basketball season.');
  async function request(url) {
    const response = await fetchImpl(url, { redirect: 'error', signal, headers: { 'User-Agent': 'ScraperAgent/1.0' } });
    if (!response.ok) throw new Error('Yahoo public ADP is unavailable.');
    const chunks = []; let length = 0;
    for await (const chunk of response.body) {
      length += chunk.length;
      if (length > 5 * 1024 * 1024) throw new Error('Yahoo response exceeded the size limit.');
      chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString('utf8');
  }
  const gameId = discoverGameId(await request(SOURCE));
  const players = [], seen = new Set();
  for (let start = 0; start < 1500; start += PAGE_SIZE) {
    // This is the anonymous public resource used by Yahoo's Draft Analysis page.
    // No account, private league, premium slices or player research is requested.
    const url = `${API}/league/${gameId}.l.public/players;position=ALL;start=${start};count=${PAGE_SIZE};sort=average_pick/draft_analysis?format=json_f`;
    const rows = parseAdpPage(JSON.parse(await request(url)), seasonId, gameId);
    for (const row of rows) {
      if (seen.has(row.id)) throw new Error('Yahoo ADP pagination repeated a player.');
      seen.add(row.id);
      if (row.adp !== null) players.push(row);
    }
    if (rows.length < PAGE_SIZE) {
      if (!players.length) throw new Error('Current-season Yahoo ADP is empty.');
      return { seasonId, yahooSeason: seasonId - 1, gameId, checkedAt: new Date(now).toISOString(), fetchedAt: new Date(now).toISOString(),
        sourceUrl: SOURCE, basis: 'All drafts; standard scoring settings', kind: 'draft market value',
        scannedPlayers: seen.size, players };
    }
  }
  throw new Error('Yahoo ADP exceeded the player limit before pagination completed.');
}

module.exports = { SOURCE, discoverGameId, parseAdpPage, collectYahooAdp };
