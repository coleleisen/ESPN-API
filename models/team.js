const mongoose = require('mongoose')
const category = require('../models/category.js');
const player = require('../models/player.js');
const Schema = mongoose.Schema;
const Team = new Schema({
  teamName: {
    type: String,
    required: [true, 'Team name is required']
  },
  teamId: String,
  logo: String,
  catAvg : [category],
  players : [player]
})

module.exports = Team
