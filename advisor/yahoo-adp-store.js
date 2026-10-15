const mongoose = require('mongoose');
const { createPublicCache } = require('./public-cache');
const { collectYahooAdp } = require('./yahoo-adp');

const schema = new mongoose.Schema({ seasonId: { type: Number, required: true, unique: true },
  lastAttemptAt: Date, lastError: String, data: mongoose.Schema.Types.Mixed });
const YahooAdp = mongoose.models.YahooAdp || mongoose.model('YahooAdp', schema);

function createYahooAdpStore({ read = seasonId => YahooAdp.findOne({ seasonId }).lean().exec(),
  write = (seasonId, changes) => YahooAdp.findOneAndUpdate({ seasonId }, { $set: changes }, { upsert: true, new: true, runValidators: true }).lean().exec(),
  collect = collectYahooAdp, now = Date.now } = {}) {
  return createPublicCache({ source: 'Yahoo ADP', read, write, collect, now,
    validate(data, saved, seasonId) {
      if (data?.seasonId !== seasonId || data.yahooSeason !== seasonId - 1 || !data.players?.length) {
        throw new Error('Current-season Yahoo ADP is unavailable.');
      }
    } });
}

module.exports = { YahooAdp, createYahooAdpStore, getYahooAdp: createYahooAdpStore() };
