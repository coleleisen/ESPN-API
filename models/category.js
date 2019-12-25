const mongoose = require('mongoose')
const category = require('../models/category.js');
const team = require('../models/team.js');
const player = require('../models/player.js');
const league = require('../models/league.js');

const Category = new mongoose.Schema({
  name : String,
  number : String
})

module.exports = Category