const { test } = require('node:test');
const assert = require('node:assert/strict');
const { League, saveLeague } = require('../scraper/persistence');

function snapshot() {
  return {
    leagueName: 'IFHL', sport: 'hockey', leagueId: '123', seasonId: 2027,
    lastUpdate: new Date('2026-10-07T12:00:00Z'), statsPeriod: 'currSeason',
    catAvg: [{ name: 'GAA', number: 2.5, lowerIsBetter: true }],
    teams: [{ teamName: 'Test Team', logo: 'https://example.com/logo.png', teamId: '1',
      catAvg: [{ name: 'G', number: 1 }],
      players: [{ name: 'Test Player', playerId: '42', image: 'https://example.com/player.png',
        position: 'C', injured: false, categories: [{ name: 'G', number: 1 }] }]
    }]
  };
}

test('scraper fields survive validation and JSON serialization', async () => {
  const league = new League(snapshot());
  await league.validate();
  const data = JSON.parse(JSON.stringify(league));
  assert.equal(data.teams[0].players[0].name, 'Test Player');
  assert.equal(data.teams[0].logo, 'https://example.com/logo.png');
  assert.equal(data.lastUpdate, '2026-10-07T12:00:00.000Z');
  assert.equal(data.catAvg[0].lowerIsBetter, true);
  assert.equal(data.sport, 'hockey');
});

test('previous playerName and lastUpdated inputs remain compatible', async () => {
  const data = snapshot();
  data.lastUpdated = data.lastUpdate;
  delete data.lastUpdate;
  const player = data.teams[0].players[0];
  player.playerName = player.name;
  delete player.name;
  const league = new League(data);
  await league.validate();
  assert.equal(league.teams[0].players[0].name, 'Test Player');
  assert(league.lastUpdate instanceof Date);
});

test('invalid scrape never touches the existing database document', async () => {
  const data = snapshot();
  delete data.teams[0].players[0].name;
  let writes = 0;
  class Model extends League {}
  Model.findOneAndUpdate = () => { writes++; };
  await assert.rejects(saveLeague(data, Model), /Player name is required/);
  assert.equal(writes, 0);
});

test('successful scrape uses one validated atomic update and propagates save errors', async () => {
  let writes = 0;
  class Model extends League {}
  Model.findOneAndUpdate = async (query, update, options) => {
    writes++;
    assert.deepEqual(query, { leagueName: 'IFHL' });
    assert.equal(update.$set.teams[0].players[0].name, 'Test Player');
    assert.equal(update.$set._id, undefined);
    assert.equal(options.upsert, true);
    assert.equal(options.runValidators, true);
    throw new Error('database unavailable');
  };
  await assert.rejects(saveLeague(snapshot(), Model), /database unavailable/);
  assert.equal(writes, 1);
});
