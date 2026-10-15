const SIX_HOURS = 6 * 60 * 60 * 1000;
const RETRY_DELAY = 15 * 60 * 1000;

// Each provider has its own collection and validation, but shares refresh rules.
function createPublicCache({ source, read, write, collect, validate, now = Date.now }) {
  const pending = new Map();
  return async function dataFor(seasonId, { refresh = false, force = false } = {}) {
    if (pending.has(seasonId)) return pending.get(seasonId);
    const work = (async () => {
      let saved;
      try { saved = await read(seasonId); } catch { return { lastError: `Saved ${source} rankings are unavailable.` }; }
      if (!refresh || (saved?.lastAttemptAt && now() - new Date(saved.lastAttemptAt) < RETRY_DELAY)
        || (!force && saved?.data?.checkedAt && now() - new Date(saved.data.checkedAt) < SIX_HOURS)) return saved;
      const lastAttemptAt = new Date(now());
      try {
        // Persist attempts so a source outage cannot trigger a scrape for every chat.
        await write(seasonId, { lastAttemptAt });
        const data = await collect(seasonId);
        validate(data, saved, seasonId);
        return await write(seasonId, { data, lastAttemptAt, lastError: null });
      } catch {
        const lastError = `${source} refresh failed. Any previously saved rankings have been retained.`;
        try { await write(seasonId, { lastAttemptAt, lastError }); } catch { /* Chat can still use the prior dataset. */ }
        return { ...saved, lastAttemptAt, lastError };
      }
    })();
    pending.set(seasonId, work);
    try { return await work; } finally { pending.delete(seasonId); }
  };
}

module.exports = { createPublicCache, SIX_HOURS };
