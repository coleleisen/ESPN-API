const mongoose = require('mongoose')
const category = require('../models/category.js');
const team = require('../models/team.js');
const player = require('../models/player.js');
const league = require('../models/league.js');
var Schema = mongoose.Schema;
const League = new Schema({
  leagueName: {
    type: String,
    required: [true, 'League name is required']
  },
  lastUpdate: Date,
  catAvg : [category],

  teams : [team]
})

module.exports = League