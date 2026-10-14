const express = require('express');
const { League } = require('../scraper/persistence');
const { AdvisorSnapshot, saveSnapshot } = require('../advisor/snapshot');
const { buildContext } = require('../advisor/context');
const { answerQuestion } = require('../advisor/chat');
const { collectAdvisorSnapshot } = require('../advisor/espn');
const { AdvisorError } = require('../advisor/errors');
const { modelFor, LIMITS } = require('../advisor/config');
const { strategyRevision } = require('../advisor/instructions');

function validate(body, chat = true) {
  if (!body || typeof body.league !== 'string' || !body.league.trim() || body.league.length > 100) {
    throw new AdvisorError('INVALID_LEAGUE', 'Enter a league name.', 400);
  }
  if (!chat) return { league: body.league.trim() };
  if (typeof body.message !== 'string' || !body.message.trim() || body.message.length > 4000) {
    throw new AdvisorError('INVALID_MESSAGE', 'Enter a question of up to 4,000 characters.', 400);
  }
  const history = body.history === undefined ? [] : body.history;
  if (!Array.isArray(history) || history.length > 20 || history.some(m => !m || !['user', 'assistant'].includes(m.role)
    || typeof m.content !== 'string' || !m.content.trim() || m.content.length > 12000)
    || history.reduce((n, m) => n + m.content.length, 0) > 60000) {
    throw new AdvisorError('INVALID_HISTORY', 'The conversation is too long or invalid. Start a new chat.', 400);
  }
  if ((body.teamId != null && (typeof body.teamId !== 'string' || body.teamId.length > 100))
    || (body.research !== undefined && typeof body.research !== 'boolean')) {
    throw new AdvisorError('INVALID_CHAT_OPTIONS', 'Invalid team or research setting.', 400);
  }
  return { league: body.league.trim(), message: body.message.trim(), teamId: body.teamId || '',
    research: body.research === true, history: history.map(({ role, content }) => ({ role, content })) };
}

function createChatRouter(deps = {}) {
  const loadLeague = deps.loadLeague || (name => League.findOne({ leagueName: name }).lean().exec());
  const loadSnapshot = deps.loadSnapshot || (name => AdvisorSnapshot.findOne({ leagueName: name }).lean().exec());
  const answer = deps.answer || answerQuestion;
  const refresh = deps.refresh || (async league => saveSnapshot(await collectAdvisorSnapshot(league)));
  const config = deps.config || (() => process.env);
  const now = deps.now || Date.now;
  const router = express.Router();
  let active = 0, windowStart = 0, requests = 0;
  const refreshing = new Set();

  router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  const fail = (res, error) => res.status(error.status || 500).json({ status: 'fail',
    code: error.code || 'ADVISOR_FAILED', message: error.publicMessage || 'The advisor could not load your league. Please retry.',
    ...(error.usage ? { usage: error.usage, model: error.model } : {}) });
  const limitRequests = (req, res, next) => {
    if (now() - windowStart >= 60000) { windowStart = now(); requests = 0; }
    if (requests >= 20 || active >= 2) {
      res.set('Retry-After', '60');
      return fail(res, new AdvisorError('CHAT_BUSY', 'The advisor is busy. Try again in a minute.', 429));
    }
    requests++;
    next();
  };

  async function contextFor(name) {
    const league = await loadLeague(name);
    if (!league) throw new AdvisorError('LEAGUE_NOT_FOUND', 'This league is not in the database.', 404);
    return { league, context: buildContext(league, await loadSnapshot(name)) };
  }

  router.get('/status', async (req, res) => {
    try {
      const { league } = validate({ league: req.query.league }, false);
      const { context } = await contextFor(league);
      const env = config();
      res.json({ configured: Boolean(env.OPENAI_API_KEY),
        refreshConfigured: Boolean(env.ESPN_ADVISOR_SESSION_FILE), model: modelFor(env), limits: LIMITS, strategyRevision,
        context: context.metadata, teams: context.teams.map(t => ({ id: t.id, name: t.name })) });
    } catch (error) { fail(res, error); }
  });

  router.post('/refresh', limitRequests, async (req, res) => {
    let name;
    let started = false;
    try {
      name = validate(req.body, false).league;
      if (refreshing.has(name)) throw new AdvisorError('REFRESH_BUSY', 'This league is already refreshing.', 409);
      refreshing.add(name);
      started = true;
      active++;
      const league = await loadLeague(name);
      if (!league) throw new AdvisorError('LEAGUE_NOT_FOUND', 'This league is not in the database.', 404);
      const snapshot = await refresh(league);
      res.json({ status: 'success', context: buildContext(league, snapshot).metadata });
    } catch (error) { fail(res, error); }
    finally { if (started) { refreshing.delete(name); active--; } }
  });

  router.post('/', limitRequests, async (req, res) => {
    active++;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 180000);
    const disconnected = () => { if (!res.writableEnded) controller.abort(); };
    res.on('close', disconnected);
    try {
      const request = validate(req.body);
      const env = config();
      if (!env.OPENAI_API_KEY) throw new AdvisorError('OPENAI_NOT_CONFIGURED', 'Add OPENAI_API_KEY to the API server environment to enable the advisor.', 503);
      const { context } = await contextFor(request.league);
      if (request.teamId && !context.teams.some(t => t.id === request.teamId)) throw new AdvisorError('TEAM_NOT_FOUND', 'Select a team from this league.', 400);
      res.json({ status: 'success', ...(await answer({ ...request, context }, {
        apiKey: env.OPENAI_API_KEY, model: modelFor(env), signal: controller.signal
      })) });
    } catch (error) { if (!res.destroyed) fail(res, error); }
    finally { clearTimeout(timer); res.off('close', disconnected); active--; }
  });
  return router;
}
module.exports = createChatRouter();
module.exports.createChatRouter = createChatRouter;
module.exports.validate = validate;
