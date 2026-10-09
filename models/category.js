const mongoose = require('mongoose')

const Category = new mongoose.Schema({
  name : String,
  number : String,
  lowerIsBetter: Boolean
})

module.exports = Category
