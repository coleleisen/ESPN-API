const { launchBrowser } = require('./browser');
const { beginLogin, submitVerification, assertAuthenticated } = require('./auth');
const { collectLeague } = require('./league');
const { saveLeague } = require('./persistence');
const { LoginSessions } = require('./sessions');
const { ScrapeError } = require('./errors');
const { ProfileStore } = require('./profiles');

function targetFor(leagueName, options = {}) {
  const { sport, leagueId, statsPeriod = 'currSeason' } = options;
  if (sport && !['basketball', 'hockey'].includes(sport)) throw new ScrapeError('INVALID_SPORT', 'Sport must be basketball or hockey.', 400);
  if (leagueId !== undefined && !/^\d+$/.test(String(leagueId))) throw new ScrapeError('INVALID_LEAGUE_ID', 'leagueId must be a numeric ESPN league ID.', 400);
  if (leagueId && !sport) throw new ScrapeError('MISSING_SPORT', 'Include the sport when supplying a leagueId.', 400);
  if (!['currSeason', 'lastSeason', 'projections', 'last30'].includes(statsPeriod)) throw new ScrapeError('INVALID_STATS_PERIOD', 'Unsupported statistics period.', 400);
  return { leagueName, sport, leagueId: leagueId && String(leagueId), statsPeriod };
}

function createScraper(dependencies = {}) {
  const deps = { launchBrowser, beginLogin, submitVerification, assertAuthenticated, collectLeague, saveLeague, profileStore: new ProfileStore(), ...dependencies };
  const sessions = new LoginSessions();
  async function finish(page, target, sessionToken) {
    const result = await deps.saveLeague(await deps.collectLeague(page, target));
    if (!sessionToken) return result;
    return { ...(typeof result.toObject === 'function' ? result.toObject() : result), sessionToken };
  }
  async function dispose(browser, profile, keep) {
    if (browser) await browser.close().catch(() => {});
    if (keep) profile.release();
    else await profile.discard();
  }
  return {
    async scrape(username, password, leagueName, options) {
      const target = targetFor(leagueName, options);
      const profile = await deps.profileStore.create();
      let browser;
      let pending = false;
      let verified = false;
      try {
        browser = await deps.launchBrowser({ userDataDir: profile.userDataDir });
        const page = await browser.newPage();
        page.setDefaultTimeout(45000);
        const login = await deps.beginLogin(page, username, password, target.sport || 'basketball');
        if (login.verificationRequired) {
          const challenge = sessions.add({ browser, page, target, profile, dispose: () => dispose(browser, profile, false) });
          pending = true;
          return challenge;
        }
        await deps.assertAuthenticated(page, target.sport || 'basketball');
        await profile.setVerified(true);
        verified = true;
        return await finish(page, target, profile.token);
      } catch (error) {
        if (verified) error.sessionToken = profile.token;
        throw error;
      } finally {
        if (!pending) await dispose(browser, profile, verified);
      }
    },
    async verify(challengeId, code) {
      if (typeof code !== 'string' || !/^\d{6}$/.test(code)) throw new ScrapeError('INVALID_VERIFICATION_CODE', 'Enter the six-digit verification code from ESPN.', 400);
      const session = sessions.acquire(challengeId);
      let retry = false;
      let verified = false;
      try {
        await deps.submitVerification(session.page, code);
        await deps.assertAuthenticated(session.page, session.target.sport || 'basketball');
        await session.profile.setVerified(true);
        verified = true;
        await sessions.remove(challengeId);
        return await finish(session.page, session.target, session.profile.token);
      } catch (error) {
        if (!verified && error.code !== 'ESPN_LOGIN_EXPIRED') {
          retry = true;
          sessions.release(challengeId);
        }
        if (verified) error.sessionToken = session.profile.token;
        throw error;
      } finally {
        if (!retry) {
          await sessions.remove(challengeId);
          await dispose(session.browser, session.profile, verified);
        }
      }
    },
    async scrapeWithSession(sessionToken, leagueName, options) {
      const target = targetFor(leagueName, options);
      const profile = await deps.profileStore.open(sessionToken);
      let browser;
      try {
        browser = await deps.launchBrowser({ userDataDir: profile.userDataDir });
        const page = await browser.newPage();
        page.setDefaultTimeout(45000);
        await deps.assertAuthenticated(page, target.sport || 'basketball');
        return await finish(page, target);
      } catch (error) {
        if (error.code === 'ESPN_REAUTH_REQUIRED') await profile.setVerified(false);
        throw error;
      } finally {
        await dispose(browser, profile, true);
      }
    }
  };
}

module.exports = { ...createScraper(), createScraper, targetFor };
