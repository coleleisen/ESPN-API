const { ScrapeError } = require('./errors');

// Runs in the page. Hockey renders skaters and goalies in separate sections
// with the same row indices, so each fixed/scrolled pair must stay together.
function readRenderedRoster() {
  return Array.from(document.querySelectorAll('.players-table')).map(section => {
    const left = section.querySelector('.Table--fixed-left');
    const stats = section.querySelector('.Table__Scroller table');
    const right = section.querySelector('.Table--fixed-right');
    if (!left || !stats) throw new Error('Roster tables are missing');
    const columns = table => {
      if (!table) return [];
      const rows = Array.from(table.querySelectorAll('thead tr'));
      const groups = rows.length > 1 ? Array.from(rows[0].cells).flatMap(cell => Array(cell.colSpan).fill(cell.innerText.trim())) : [];
      return Array.from(rows.at(-1).cells).map((cell, index) => ({
        name: cell.innerText.trim(), group: groups[index] || '', index
      })).filter(column => !/RESEARCH|RANK/i.test(column.group));
    };
    const statColumns = columns(stats);
    const pointColumns = columns(right).filter(column => /FANTASY|TOTAL/i.test(column.group) && /^(TOT|FPTS)$/.test(column.name));
    const statRows = Array.from(stats.querySelectorAll('tbody tr'));
    const pointRows = Array.from(right?.querySelectorAll('tbody tr') || []);
    const matchingRow = (rows, row, index) => row.hasAttribute('data-idx')
      ? rows.find(candidate => candidate.dataset.idx === row.dataset.idx) : rows[index];
    const players = Array.from(left.querySelectorAll('tbody tr')).flatMap((row, index) => {
      const bio = row.querySelector('.player-column__athlete');
      if (!bio) {
        if (/\bEmpty\b/i.test(row.innerText)) return [];
        throw new Error('Unknown roster player row');
      }
      const name = bio.title || bio.querySelector('a')?.textContent.trim();
      const statRow = matchingRow(statRows, row, index);
      const pointRow = matchingRow(pointRows, row, index);
      if (!name || !statRow || (pointColumns.length && !pointRow)) throw new Error('Roster row is incomplete');
      const image = row.querySelector('.player-headshot img:not(.fallback)')?.src || '';
      const lineupSlot = row.cells[0].innerText.trim();
      const position = row.querySelector('.playerinfo__playerpos')?.textContent.trim() || lineupSlot;
      return [{
        name, image, playerId: image.match(/\/players\/full\/(\d+)\.png/)?.[1], position, lineupSlot,
        injured: /^IR/.test(lineupSlot),
        values: [
          ...statColumns.map(column => ({ name: column.name, value: statRow.cells[column.index]?.innerText.trim() })),
          ...pointColumns.map(column => ({ name: 'FPTS', value: pointRow.cells[column.index]?.innerText.trim() }))
        ]
      }];
    });
    return { type: left.querySelector('thead tr')?.innerText, players };
  });
}

function numeric(value) {
  if (value === '--' || value === '-' || value === '') return 0;
  const number = Number(value?.replaceAll(',', ''));
  if (!Number.isFinite(number)) throw new ScrapeError('INVALID_STATISTICS', 'An ESPN statistic could not be read. Existing data was preserved.');
  return number;
}

function normalizePlayers(sections, sport) {
  if (!sections.length) throw new ScrapeError('INCOMPLETE_ROSTER', 'ESPN did not return the roster tables.');
  if (sport === 'hockey' && !sections.some(section => /GOALIES/i.test(section.type))) {
    throw new ScrapeError('INCOMPLETE_ROSTER', 'ESPN did not return the goalie table. Existing data was preserved.');
  }
  return sections.flatMap(section => section.players).map(({ values, ...player }) => {
    const stats = new Map();
    for (const { name, value } of values) {
      if (['%ROST', 'PR15', 'PR7', 'PR30', 'GP', 'GS', 'MIN'].includes(name)) continue;
      if (/^(FGM|FTM)(\/A)?$/.test(name) && value?.includes('/')) {
        const prefix = name.slice(0, 2);
        const [made, attempted] = value.split('/').map(numeric);
        stats.set(prefix + 'M', made);
        stats.set(prefix + 'A', attempted);
        stats.set(prefix + '%', attempted ? made / attempted : 0);
      } else {
        stats.set(name, numeric(value));
      }
    }
    if (!stats.size) throw new ScrapeError('INCOMPLETE_ROSTER', 'ESPN did not return player statistics.');
    return { ...player, categories: Array.from(stats, ([name, number]) => ({ name, number, lowerIsBetter: ['TO', 'GA', 'GAA'].includes(name) })) };
  });
}

function aggregate(players, names) {
  const active = players.filter(player => !player.injured);
  const sum = name => active.reduce((total, player) => total + (player.categories.find(stat => stat.name === name)?.number || 0), 0);
  return names.map(name => {
    let number = sum(name);
    if (name === 'FG%' || name === 'FT%') {
      const prefix = name.slice(0, 2);
      number = sum(prefix + 'A') ? sum(prefix + 'M') / sum(prefix + 'A') : 0;
    } else if (name === 'GAA' || name === 'SV%') {
      // HTML can omit the time-on-ice/shots-against weights. Never add rates.
      throw new ScrapeError('UNSUPPORTED_RATE_STATISTICS', 'This league requires goalie rate-stat weights that are not present in the roster tables. Existing data was preserved.');
    }
    return { name, number: Number(number.toFixed(3)), lowerIsBetter: ['TO', 'GA', 'GAA'].includes(name) };
  });
}

function completeSnapshot(teams, target, seasonId) {
  const names = [...new Set(teams.flatMap(team => team.players.flatMap(player => player.categories.map(stat => stat.name))))];
  if (!teams.length || !names.length || teams.some(team => !team.players.length)) {
    throw new ScrapeError('INCOMPLETE_LEAGUE', 'ESPN did not return a complete league. Existing data was preserved.');
  }
  // Keep every team/player in the same category order, including zeros and
  // non-applicable skater/goalie categories used by the trade view.
  for (const team of teams) {
    for (const player of team.players) {
      player.categories = names.map(name => player.categories.find(stat => stat.name === name)
        || { name, number: 0, lowerIsBetter: ['TO', 'GA', 'GAA'].includes(name) });
    }
    team.catAvg = aggregate(team.players, names);
  }
  const catAvg = aggregate(teams.flatMap(team => team.players), names).map(stat => ({
    ...stat, number: ['FG%', 'FT%'].includes(stat.name) ? stat.number : Number((stat.number / teams.length).toFixed(3))
  }));
  return { leagueName: target.leagueName, leagueId: target.leagueId, sport: target.sport,
    seasonId, statsPeriod: target.statsPeriod, scoringType: names.includes('FPTS') ? 'points' : 'categories',
    lastUpdate: new Date(), catAvg, teams };
}

async function readRosterTables(page, target) {
  const base = `https://fantasy.espn.com/${target.sport}`;
  await page.goto(`${base}/league/standings?leagueId=${target.leagueId}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('.season--stats--table .Table--fixed-left tbody tr');
  const standings = await page.evaluate(() => {
    // Standings names are JavaScript links without hrefs. The team menu exposes
    // real URLs, including My Team for the one omitted from Opposing Teams.
    const links = Array.from(document.querySelectorAll('.NavSecondary a[href*="teamId="]'));
    const teams = Array.from(document.querySelectorAll('.season--stats--table .Table--fixed-left tbody tr')).map(row => {
      const teamName = row.querySelector('.teamName')?.textContent.trim();
      if (!teamName) throw new Error('Standings team name is missing');
      const link = links.find(link => link.textContent.trim().startsWith(teamName + ' ('));
      const logo = row.querySelector('img')?.src || '';
      return { teamName, teamId: link && new URL(link.href).searchParams.get('teamId'), logo: logo.startsWith('data:') ? '' : logo };
    });
    const own = links.find(link => link.textContent.trim() === 'My Team');
    const unmatched = teams.filter(team => !team.teamId);
    if (unmatched.length === 1 && own) unmatched[0].teamId = new URL(own.href).searchParams.get('teamId');
    if (teams.some(team => !team.teamId)) throw new Error('Standings team link is missing');
    return teams;
  });
  if (new Set(standings.map(team => team.teamId)).size !== standings.length) throw new Error('Duplicate standings teams');
  const teams = [];
  let seasonId;
  for (const team of standings) {
    await page.goto(`${base}/team?leagueId=${target.leagueId}&teamId=${team.teamId}&statSplit=${target.statsPeriod}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('#filterStat');
    const options = await page.$eval('#filterStat', select => Array.from(select.options).map(option => ({ value: option.value, text: option.textContent })));
    const selected = options.find(option => option.value === target.statsPeriod);
    if (!selected) throw new ScrapeError('UNAVAILABLE_STATISTICS', 'The requested statistics period is unavailable for this league.');
    seasonId = Number(options.find(option => option.value === 'currSeason')?.text.match(/\d{4}/)?.[0]);
    // Loading the period in the URL avoids a race with ESPN's initial React
    // render, which can otherwise overwrite an early dropdown selection.
    await page.waitForFunction(label => Array.from(document.querySelectorAll('.players-table .Table__Scroller thead th'))
      .some(header => header.innerText.toUpperCase().includes(label.toUpperCase())), {}, selected.text);
    // Standings logos below the viewport are lazy-loaded placeholders. The
    // individual team page renders that team's real logo in its visible header.
    const logo = await page.$eval('.team-logo img', image => image.src).catch(() => '');
    if (logo && !logo.startsWith('data:')) team.logo = logo;
    teams.push({ ...team, players: normalizePlayers(await page.evaluate(readRenderedRoster), target.sport) });
  }
  return completeSnapshot(teams, target, seasonId);
}

module.exports = { readRosterTables, readRenderedRoster, normalizePlayers, completeSnapshot };
