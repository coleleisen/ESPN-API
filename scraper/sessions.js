const { randomUUID } = require('crypto');
const { ScrapeError } = require('./errors');

class LoginSessions {
  constructor(ttl = 15 * 60 * 1000) {
    this.ttl = ttl;
    this.sessions = new Map();
  }

  add(session) {
    if (this.sessions.size >= 4) {
      throw new ScrapeError('TOO_MANY_LOGINS', 'Too many ESPN logins are waiting for verification. Please try again later.', 429);
    }
    const id = randomUUID();
    const timer = setTimeout(() => this.remove(id, true), this.ttl);
    timer.unref();
    this.sessions.set(id, { ...session, timer, busy: false });
    return { verificationRequired: true, challengeId: id, expiresInSeconds: this.ttl / 1000 };
  }

  acquire(id) {
    const session = this.sessions.get(id);
    if (!session) throw new ScrapeError('ESPN_LOGIN_EXPIRED', 'The ESPN login session expired. Start the scrape again.', 410);
    if (session.busy) throw new ScrapeError('VERIFICATION_IN_PROGRESS', 'This verification is already in progress.', 409);
    session.busy = true;
    return session;
  }

  release(id) {
    const session = this.sessions.get(id);
    if (session) session.busy = false;
  }

  async remove(id, closeBrowser = false) {
    const session = this.sessions.get(id);
    if (!session) return;
    clearTimeout(session.timer);
    this.sessions.delete(id);
    if (closeBrowser) {
      if (session.dispose) await session.dispose().catch(() => {});
      else await session.browser.close().catch(() => {});
    }
  }
}

module.exports = { LoginSessions };
