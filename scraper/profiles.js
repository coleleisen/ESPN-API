const fs = require('fs/promises');
const path = require('path');
const { createHash, randomBytes } = require('crypto');
const { ScrapeError } = require('./errors');

const activeProfiles = new Set();

class ProfileStore {
  constructor(directory) {
    this.directory = directory;
  }

  get root() {
    return path.resolve(this.directory || process.env.ESPN_SESSION_DIR || path.join(__dirname, '..', '.espn-sessions'));
  }

  profilePath(token) {
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) {
      throw new ScrapeError('ESPN_SESSION_NOT_FOUND', 'The saved ESPN session is unavailable. Sign in again.', 401);
    }
    return path.join(this.root, createHash('sha256').update(token).digest('hex'));
  }

  async create() {
    const token = randomBytes(32).toString('hex');
    const directory = this.profilePath(token);
    await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
    await fs.mkdir(directory, { mode: 0o700 });
    const lease = this.lease(token, directory);
    try {
      await lease.setVerified(false);
      return lease;
    } catch (error) {
      await lease.discard();
      throw error;
    }
  }

  async open(token) {
    const directory = this.profilePath(token);
    let metadata;
    try {
      metadata = JSON.parse(await fs.readFile(path.join(directory, 'session.json'), 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
      throw new ScrapeError('ESPN_SESSION_NOT_FOUND', 'The saved ESPN session is unavailable. Sign in again.', 401);
    }
    if (metadata.verified !== true) {
      throw new ScrapeError('ESPN_REAUTH_REQUIRED', 'ESPN needs a new verified login before scheduled scraping can resume.', 401);
    }
    return this.lease(token, directory);
  }

  lease(token, directory) {
    if (activeProfiles.has(directory)) throw new ScrapeError('ESPN_SESSION_BUSY', 'A scrape is already using this ESPN session. Retry after it completes.', 409);
    activeProfiles.add(directory);
    const release = () => activeProfiles.delete(directory);
    return {
      token,
      userDataDir: path.join(directory, 'browser'),
      setVerified: async verified => {
        const temporary = path.join(directory, 'session.tmp');
        await fs.writeFile(temporary, JSON.stringify({ version: 1, verified }), { mode: 0o600 });
        await fs.rename(temporary, path.join(directory, 'session.json'));
      },
      release,
      discard: async () => {
        // Only delete this store's generated child directory, never an arbitrary browser profile.
        const resolved = path.resolve(directory);
        if (path.dirname(resolved) !== this.root || !/^[a-f0-9]{64}$/.test(path.basename(resolved))) {
          throw new Error('Invalid session directory');
        }
        try { await fs.rm(resolved, { recursive: true, force: true }); }
        finally { release(); }
      }
    };
  }
}

module.exports = { ProfileStore };
