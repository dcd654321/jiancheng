const resources = require('./cloud-resources');

// The owner and environment IDs were read from the resource owner's live cloud listing.
// NOT active: sharing, identity semantics and data access rules still need controlled verification.
// Do not copy test data or re-use its cached queue when switching collections/environments.
module.exports = {
  enabled: false,
  mode: 'shared',
  envId: 'product-d2g59zty74d7d1ec1',
  resourceAppid: 'wx7ad85943fe81e095',
  functionName: resources.apiFunction,
  storageNamespace: 'jiancheng_daka'
};
