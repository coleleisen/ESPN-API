const { load } = require('cheerio');

const SOURCE = 'https://basketballmonster.com/playerrankings.aspx';
const CATEGORY_COLUMNS = { PTS: 'pV', '3PM': '3V', REB: 'rV', AST: 'aV', STL: 'sV', BLK: 'bV', 'FG%': 'fg%V', 'FT%': 'ft%V', TO: 'toV' };
const seasonLabel = year => `NBA ${String(year - 1).slice(-2)}-${String(year).slice(-2)}`;
const numeric = value => /^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(value) ? Number(value) : null;

function parseRankings(html, seasonId, fetchedAt = new Date()) {
  const $ = load(html);
  const season = $('select[name="DataSetControl"] option:selected').text().trim();
  if (season !== seasonLabel(seasonId)
    || $('h1').first().text().trim() !== `Player Rankings ${season.slice(4)}`
    || $('select[name="DateFilterControl"]').val() !== 'FullSeason'
    || $('select[name="ValueDisplayType"]').val() !== 'PerGame'
    || $('input[name^="cat_"]:checked').length
    || $('input[name^="PuntCategoriesControl_weight_"]').toArray().some(e => !['', '1'].includes($(e).val() || ''))) {
    throw new Error('Basketball Monster season or ranking settings could not be verified.');
  }
  const tables = $('table').toArray().filter(t => $(t).find('th').toArray().some(c => $(c).text().trim() === 'Name'));
  if (tables.length > 1) throw new Error('Unexpected Basketball Monster ranking tables.');
  const players = [];
  if (tables.length) {
    const table = $(tables[0]);
    const columns = table.find('tr').first().children('th').toArray().map(c => $(c).text().trim());
    const required = ['Name', 'Rank', 'Value', 'g', ...Object.values(CATEGORY_COLUMNS)];
    if (required.some(c => columns.filter(v => v === c).length !== 1)) throw new Error('Basketball Monster category columns changed.');
    for (const row of table.find('tr').toArray()) {
      const cells = $(row).children('td');
      if (!cells.length) continue; // Repeated round headings use TH cells.
      if (cells.length !== columns.length) throw new Error('Incomplete Basketball Monster player row.');
      const cell = name => cells.eq(columns.indexOf(name));
      const value = name => numeric(cell(name).text().trim());
      const id = new URL(cell('Name').find('a').attr('href') || '', SOURCE).searchParams.get('i');
      const name = cell('Name').text().trim();
      const games = value('g');
      if (!/^\d+$/.test(id || '') || !name || name.length > 140 || !Number.isInteger(games) || games < 0) {
        throw new Error('Invalid Basketball Monster player identity or sample size.');
      }
      if (!games) continue;
      const rank = value('Rank'), overallValue = value('Value');
      const zScores = Object.fromEntries(Object.entries(CATEGORY_COLUMNS).map(([category, column]) => [category, value(column)]));
      if (!Number.isInteger(rank) || rank < 1 || overallValue === null || Object.values(zScores).some(v => v === null)) {
        throw new Error('Missing Basketball Monster rank or category value.');
      }
      players.push({ id, name, rank, overallValue, games, zScores });
    }
  }
  if (players.length > 1500 || new Set(players.map(p => p.id)).size !== players.length) throw new Error('Invalid Basketball Monster player pool.');
  return { seasonId, seasonLabel: season, sourceUrl: SOURCE, fetchedAt: new Date(fetchedAt).toISOString(),
    kind: 'actual', period: 'full season', basis: 'per game', settings: 'Public standard nine-category values, no punts; not customized to this league.', players };
}

function allPlayersForm(html) {
  const $ = load(html), params = new URLSearchParams();
  $('form input[name], form select[name]').each((_, e) => {
    const element = $(e), type = element.attr('type');
    if (element.is(':disabled') || ['submit', 'button', 'file'].includes(type)
      || (['checkbox', 'radio'].includes(type) && !element.is(':checked'))) return;
    params.set(element.attr('name'), element.val() || '');
  });
  params.set('PlayerFilterControl', 'AllPlayers');
  params.set('DateFilterControl', 'FullSeason');
  params.set('ValueDisplayType', 'PerGame');
  params.set('StatDisplayType', 'PerGame');
  return params;
}

async function collectPublicRankings(seasonId, { fetchImpl = fetch, now = new Date(), signal = AbortSignal.timeout(20000) } = {}) {
  if (!Number.isInteger(seasonId) || seasonId < 2005 || seasonId > 2100) throw new Error('Invalid basketball season.');
  const cookies = new Map();
  async function request(url, body, redirects = 0) {
    const response = await fetchImpl(url, { method: body ? 'POST' : 'GET', redirect: 'manual', signal,
      headers: { 'User-Agent': 'ScraperAgent/1.0', ...(cookies.size ? { Cookie: [...cookies.values()].join('; ') } : {}),
        ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) }, ...(body ? { body: body.toString() } : {}) });
    const setCookies = response.headers.getSetCookie?.() || [];
    for (const cookie of setCookies) { const pair = cookie.split(';')[0]; cookies.set(pair.split('=')[0], pair); }
    if ([301, 302, 303].includes(response.status)) {
      const target = new URL(response.headers.get('location'), url);
      await response.body?.cancel();
      if (redirects >= 2 || target.origin !== new URL(SOURCE).origin || target.pathname.toLowerCase() !== '/playerrankings.aspx') {
        throw new Error('Basketball Monster redirected away from public rankings.');
      }
      return request(target.href, undefined, redirects + 1);
    }
    if (!response.ok) throw new Error('Basketball Monster is unavailable.');
    const chunks = []; let length = 0;
    for await (const chunk of response.body) {
      length += chunk.length;
      if (length > 5 * 1024 * 1024) throw new Error('Basketball Monster response exceeded the size limit.');
      chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString('utf8');
  }
  const landing = await request(SOURCE), $ = load(landing);
  const datasets = [], unavailableSeasons = [];
  for (const year of [seasonId, seasonId - 1]) {
    const option = $('select[name="DataSetControl"] option').toArray().find(e => $(e).text().trim() === seasonLabel(year));
    if (!option) { unavailableSeasons.push(year); continue; }
    const id = $(option).attr('value');
    if (!/^\d+$/.test(id)) throw new Error('Invalid Basketball Monster dataset.');
    const url = `${SOURCE}?ds=${id}`;
    const html = $('select[name="DataSetControl"]').val() === id ? landing : await request(url);
    const form = allPlayersForm(html);
    const all = await request(url, form);
    if (load(all)('select[name="PlayerFilterControl"]').val() !== 'AllPlayers') throw new Error('Basketball Monster did not return all players.');
    const dataset = parseRankings(all, year, now);
    dataset.sourceUrl = url;
    datasets.push(dataset);
  }
  if (!datasets.length) throw new Error('No matching Basketball Monster seasons were found.');
  return { seasonId, checkedAt: new Date(now).toISOString(), unavailableSeasons, datasets };
}

module.exports = { collectPublicRankings, parseRankings, allPlayersForm, CATEGORY_COLUMNS };
