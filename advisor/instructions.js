const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

// Load at startup: editing AGENTS.md takes effect on restart/deployment.
// Keep this small because it is sent with each model call.
const STRATEGY_INSTRUCTIONS = fs.readFileSync(path.join(__dirname, 'AGENTS.md'), 'utf8').replace(/\r\n/g, '\n').trim();
if (!STRATEGY_INSTRUCTIONS || Buffer.byteLength(STRATEGY_INSTRUCTIONS) > 6000) {
  throw new Error('advisor/AGENTS.md must contain between 1 and 6,000 bytes of strategy instructions.');
}
const strategyRevision = createHash('sha256').update(STRATEGY_INSTRUCTIONS).digest('hex').slice(0, 12);

module.exports = { STRATEGY_INSTRUCTIONS, strategyRevision };
