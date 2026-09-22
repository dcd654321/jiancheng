// Enable only after server identity, moderation, quota and real-device checks.
// No API keys or model provider credentials belong in the mini-program package.
const { planFunction } = require('./cloud-resources');
module.exports = { enabled: false, functionName: planFunction, timeoutMs: 12000 };
