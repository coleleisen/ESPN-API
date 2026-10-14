// Standard USD rates per million tokens, verified 2026-10-14:
// https://developers.openai.com/api/docs/pricing
const PRICES = {
  'gpt-6.1-sol': { input: 2, cached: 0.1, write: 2.5, output: 10 },
  'gpt-6-astra': { input: 10, cached: 1, write: 12.5, output: 50 },
  'gpt-6-luna': { input: 0.1, cached: 0.01, write: 0.125, output: 0.5 }
};
const createUsage = () => ({ inputTokens: 0, cachedInputTokens: 0, outputTokens: 0,
  reasoningTokens: 0, modelCalls: 0, webSearchCalls: 0 });
function recordUsage(usage, response) {
  usage.inputTokens += response.usage?.input_tokens || 0;
  usage.cachedInputTokens += response.usage?.input_tokens_details?.cached_tokens || 0;
  usage.outputTokens += response.usage?.output_tokens || 0;
  usage.reasoningTokens += response.usage?.output_tokens_details?.reasoning_tokens || 0;
  usage.webSearchCalls += (response.output || []).filter(o => o.type === 'web_search_call').length;
  if (!response.usage) usage.billingIncomplete = true;
}
function reportedUsage(usage, model) {
  const price = PRICES[model];
  // Use the higher cache-write rate for all uncached input: a conservative
  // estimate even when the response doesn't identify cache writes separately.
  const estimate = price && ((Math.max(0, usage.inputTokens - usage.cachedInputTokens) * price.write
    + usage.cachedInputTokens * price.cached + usage.outputTokens * price.output) / 1e6
    + usage.webSearchCalls * 0.01);
  return { ...usage, estimatedCostUsd: price ? Number(estimate.toFixed(6)) : null,
    pricingAsOf: '2026-10-14', estimateBasis: 'Standard rates; uncached input estimated at the cache-write rate. Actual billing may differ.' };
}
module.exports = { createUsage, recordUsage, reportedUsage };
