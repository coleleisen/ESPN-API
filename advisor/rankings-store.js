const mongoose = require('mongoose');
const { collectPublicRankings } = require('./basketball-monster');

const SIX_HOURS = 6 * 60 * 60 * 1000;
const RETRY_DELAY = 15 * 60 * 1000;
const schema = new mongoose.Schema({ seasonId: { type: Number, required: true, unique: true },
  lastAttemptAt: Date, lastError: String, data: mongoose.Schema.Types.Mixed });
const PublicRankings = mongoose.models.PublicRankings || mongoose.model('PublicRankings', schema);

function createRankingsStore({ read = seasonId => PublicRankings.findOne({ seasonId }).lean().exec(),
  write = (seasonId, changes) => PublicRankings.findOneAndUpdate({ seasonId }, { $set: changes }, { upsert: true, new: true, runValidators: true }).lean().exec(),
  collect = collectPublicRankings, now = Date.now } = {}) {
  const pending = new Map();
  return async function rankingsFor(seasonId, { refresh = false, force = false } = {}) {
    if (pending.has(seasonId)) return pending.get(seasonId);
    const work = (async () => {
      let saved;
      try { saved = await read(seasonId); } catch { return { lastError: 'Saved Basketball Monster rankings are unavailable.' }; }
      if (!refresh || (saved?.lastAttemptAt && now() - new Date(saved.lastAttemptAt) < RETRY_DELAY)
        || (!force && saved?.data?.checkedAt && now() - new Date(saved.data.checkedAt) < SIX_HOURS)) return saved;
      const lastAttemptAt = new Date(now());
      try {
        // Persist attempts so a source outage cannot trigger a scrape for every chat.
        await write(seasonId, { lastAttemptAt });
        const data = await collect(seasonId);
        for (const prior of saved?.data?.datasets || []) {
          const replacement = data.datasets.find(d => d.seasonId === prior.seasonId);
          if (prior.players.length && !replacement?.players.length) throw new Error('A populated ranking season became empty.');
        }
        return await write(seasonId, { data, lastAttemptAt, lastError: null });
      } catch {
        const lastError = 'Basketball Monster refresh failed. Any previously saved rankings have been retained.';
        try { await write(seasonId, { lastAttemptAt, lastError }); } catch { /* Chat can still use the prior dataset. */ }
        return { ...saved, lastAttemptAt, lastError };
      }
    })();
    pending.set(seasonId, work);
    try { return await work; } finally { pending.delete(seasonId); }
  };
}

module.exports = { PublicRankings, createRankingsStore, getPublicRankings: createRankingsStore(), SIX_HOURS };
