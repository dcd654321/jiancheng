// Active personal TEST deployment. Its prefixed account was verified against a
// complete backup before switching. The namespace keeps old consent, binding,
// and pending queues intact instead of replaying them into the new collection.
// Shared product remains separately gated by cloud.product.js.
module.exports = {
  enabled: true,
  envId: 'cloud1-d4gq76oyt363f08a7',
  functionName: 'jiancheng_daka_api',
  storageNamespace: 'jiancheng_daka'
};
