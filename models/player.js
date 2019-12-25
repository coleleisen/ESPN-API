const mongoose = require('mongoose')
const category = require('../models/category.js');
const team = require('../models/team.js');
const player = require('../models/player.js');
const league = require('../models/league.js');
const Schema = mongoose.Schema;
const Player = new Schema({
  playerName: {
    type: String,
    required: [true, 'Player name is required']
  },
 image : String,
 position : String,
 injured : Boolean,
 categories : [category]
})

module.exports = Player