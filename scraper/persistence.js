const mongoose = require('mongoose');
const schema = require('../models/league');

const League = mongoose.models.League || mongoose.model('League', schema);

async function saveLeague(payload, model = League) {
  const document = new model(payload);
  await document.validate();
  const data = document.toObject();
  delete data._id;
  delete data.__v;
  // Validate the entire snapshot before atomically updating the existing league.
  return model.findOneAndUpdate(
    { leagueName: data.leagueName },
    { $set: data },
    { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
  );
}

module.exports = { saveLeague, League };
