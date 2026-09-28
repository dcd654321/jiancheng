// Active personal TEST deployment. Its prefixed account was verified against a
// complete backup before switching. Cloud is the only active data source;
// previously written device keys are not read, replayed, or silently deleted.
// Shared product remains separately gated by cloud.product.js.
module.exports = {
  enabled: true,
  envId: 'cloud1-d4gq76oyt363f08a7',
  functionName: 'jiancheng_daka_api',
  storageNamespace: 'jiancheng_daka'
};
