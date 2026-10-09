const mongoose = require('mongoose')
const category = require('../models/category.js');
const team = require('../models/team.js');
var Schema = mongoose.Schema;
const League = new Schema({
  leagueName: {
    type: String,
    required: [true, 'League name is required']
  },
  lastUpdate: { type: Date, alias: 'lastUpdated' },
  leagueId: String,
  sport: { type: String, enum: ['basketball', 'hockey'] },
  seasonId: Number,
  statsPeriod: String,
  scoringType: { type: String, enum: ['points', 'categories'] },
  catAvg : [category],

  teams : [team]
})

module.exports = League
