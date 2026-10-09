const { ScrapeError } = require('./errors');
const { readRosterTables } = require('./roster');

async function resolveLeague(page, target) {
  if (target.leagueId) return target;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('a[href*="leagueId="]', { timeout: 45000 }).catch(() => {});
  const leagues = await page.evaluate(() => Array.from(document.querySelectorAll('a[href*="leagueId="]')).map(link => {
    const item = link.closest('.favItem');
    return {
      name: (item && item.querySelector('.favItem__subHead') || link.querySelector('.favItem__subHead') || link).textContent.trim(),
      href: link.href
    };
  }));
  const matches = leagues.filter(league => league.name.toLowerCase() === target.leagueName.toLowerCase()).map(league => {
    const url = new URL(league.href);
    const sport = url.pathname.split('/').find(part => ['hockey', 'basketball'].includes(part));
    return { ...target, leagueId: url.searchParams.get('leagueId'), sport };
  }).filter(league => league.sport && /^\d+$/.test(league.leagueId) && (!target.sport || league.sport === target.sport));
  const unique = [...new Map(matches.map(league => [league.sport + league.leagueId, league])).values()];
  if (unique.length !== 1) {
    throw new ScrapeError('LEAGUE_NOT_FOUND', 'Could not uniquely find this league in the signed-in account. Supply its leagueId and sport.', 404);
  }
  return unique[0];
}

async function collectLeague(page, target) {
  const resolved = await resolveLeague(page, target);
  await page.goto(`https://fantasy.espn.com/${resolved.sport}/team?leagueId=${resolved.leagueId}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  let snapshot;
  try {
    snapshot = await readRosterTables(page, resolved);
  } catch (error) {
    const loginRequired = await page.evaluate(() => /log\s?in required to access this page/i.test(document.body.innerText)).catch(() => false);
    if (loginRequired) throw new ScrapeError('ESPN_REAUTH_REQUIRED', 'ESPN needs a new verified login before scheduled scraping can resume.', 401);
    throw error;
  }
  if (!snapshot.teams.length || !snapshot.catAvg.length) {
    throw new ScrapeError('INCOMPLETE_LEAGUE', 'ESPN did not return a complete league. Existing data was preserved.');
  }
  for (const team of snapshot.teams) {
    const categories = [...team.catAvg, ...team.players.flatMap(player => player.categories)];
    if (categories.some(category => /^(NaN|Infinity|-Infinity)$/.test(String(category.number)))) {
      throw new ScrapeError('INVALID_STATISTICS', 'ESPN statistics could not be read completely. Existing data was preserved.');
    }
  }
  return snapshot;
}

module.exports = { collectLeague, resolveLeague };
