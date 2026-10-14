// A dedicated setting makes the cost-saving default apply to existing deployments
// that still have the old, general OPENAI_MODEL=gpt-6-astra setting.
const DEFAULT_MODEL = 'gpt-6.1-sol';
const modelFor = (env = process.env) => env.OPENAI_ADVISOR_MODEL || DEFAULT_MODEL;
const LIMITS = Object.freeze({ modelCalls: 3, lookupCalls: 4, webSearchCalls: 2,
  outputTokens: 4000, outputTokensPerCall: 1800, promptBytes: 60000,
  historyMessages: 12, historyCharacters: 12000, historyMessageCharacters: 4000 });

function trimHistory(history = []) {
  const kept = [];
  let size = 0;
  for (const message of history.slice(-LIMITS.historyMessages).reverse()) {
    const content = message.content.slice(0, LIMITS.historyMessageCharacters);
    if (size + content.length > LIMITS.historyCharacters) break;
    kept.unshift({ role: message.role, content });
    size += content.length;
  }
  return kept;
}
module.exports = { DEFAULT_MODEL, modelFor, LIMITS, trimHistory };
