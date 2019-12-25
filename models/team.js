const mongoose = require('mongoose')
const category = require('../models/category.js');
const team = require('../models/team.js');
const player = require('../models/player.js');
const league = require('../models/league.js');
const Schema = mongoose.Schema;
const Team = new Schema({
  teamName: {
    type: String,
    required: [true, 'Team name is required']
  },
  catAvg : [category],
  players : [player]
})

module.exports = Team