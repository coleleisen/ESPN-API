const mongoose = require('mongoose')
const category = require('../models/category.js');
const Schema = mongoose.Schema;
const Player = new Schema({
  name: {
    type: String,
    alias: 'playerName',
    required: [true, 'Player name is required']
  },
 playerId: String,
 image : String,
 position : String,
 lineupSlot: String,
 injured : Boolean,
 categories : [category]
})

module.exports = Player
