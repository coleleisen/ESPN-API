const espn = require('../scraper/espn');
const express = require('express');
const router = express.Router();

router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

function respond(res, result) {
  if (result.verificationRequired) {
    return res.status(409).json({
      status: 'verification_required', code: 'ESPN_VERIFICATION_REQUIRED',
      message: 'ESPN sent a verification code. Submit it to /scrape/verify with this challengeId.',
      challengeId: result.challengeId, expiresInSeconds: result.expiresInSeconds
    });
  }
  return res.status(200).json({
    status: 'success', message: 'completed scrape and placed in db',
    league: result.leagueName, teams: result.teams.length, lastUpdate: result.lastUpdate,
    ...(result.sessionToken ? { sessionToken: result.sessionToken } : {})
  });
}

function fail(res, error) {
  if (!error.publicMessage) {
    // Keep diagnostic details to error type and local stack locations, without request data.
    console.error('Scrape failed:', error.name, (error.stack || '').split('\n').slice(1).filter(line => /scraper|routes/.test(line)).slice(0, 3).join('\n'));
  }
  return res.status(error.status || 500).json({
    status: 'fail', code: error.code || 'SCRAPE_FAILED',
    message: error.publicMessage || 'Unable to scrape the league. Existing league data was preserved.',
    // A completed login is reusable even when reading/saving the league subsequently fails.
    ...(error.sessionToken ? { sessionToken: error.sessionToken } : {})
  });
}

router.post('/', async (req, res) => {
  if (typeof req.body.league !== 'string' || !req.body.league.trim()) {
    return res.status(200).json({ message: 'must include league', status: 'fail' });
  }
  const options = { sport: req.body.sport, leagueId: req.body.leagueId, statsPeriod: req.body.statsPeriod };
  try {
    if (Object.prototype.hasOwnProperty.call(req.body, 'sessionToken')) {
      return respond(res, await espn.scrapeWithSession(req.body.sessionToken, req.body.league.trim(), options));
    }
    if (typeof req.body.username !== 'string' || !req.body.username.trim()) {
      return res.status(200).json({ message: 'must include username or sessionToken', status: 'fail' });
    }
    if (typeof req.body.password !== 'string' || !req.body.password) {
      return res.status(200).json({ message: 'must include password', status: 'fail' });
    }
    return respond(res, await espn.scrape(req.body.username.trim(), req.body.password, req.body.league.trim(), options));
  } catch (error) {
    return fail(res, error);
  }
});

router.post('/verify', async (req, res) => {
  if (typeof req.body.challengeId !== 'string' || !req.body.challengeId) {
    return res.status(400).json({ status: 'fail', message: 'Include the challengeId from the login request.' });
  }
  try {
    return respond(res, await espn.verify(req.body.challengeId, req.body.code));
  } catch (error) {
    return fail(res, error);
  }
});

module.exports = router;
