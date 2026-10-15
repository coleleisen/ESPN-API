const mongoose = require('mongoose');
const { collectPublicRankings } = require('./basketball-monster');
const { createPublicCache, SIX_HOURS } = require('./public-cache');

const schema = new mongoose.Schema({ seasonId: { type: Number, required: true, unique: true },
  lastAttemptAt: Date, lastError: String, data: mongoose.Schema.Types.Mixed });
const PublicRankings = mongoose.models.PublicRankings || mongoose.model('PublicRankings', schema);

function createRankingsStore({ read = seasonId => PublicRankings.findOne({ seasonId }).lean().exec(),
  write = (seasonId, changes) => PublicRankings.findOneAndUpdate({ seasonId }, { $set: changes }, { upsert: true, new: true, runValidators: true }).lean().exec(),
  collect = collectPublicRankings, now = Date.now } = {}) {
  return createPublicCache({ source: 'Basketball Monster', read, write, collect, now,
    validate(data, saved) {
      for (const prior of saved?.data?.datasets || []) {
        const replacement = data.datasets.find(d => d.seasonId === prior.seasonId);
        if (prior.players.length && !replacement?.players.length) throw new Error('A populated ranking season became empty.');
      }
    } });
}

module.exports = { PublicRankings, createRankingsStore, getPublicRankings: createRankingsStore(), SIX_HOURS };
