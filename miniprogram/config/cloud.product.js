const resources = require('./cloud-resources');

// Prepared production target, NOT active. "product" is a display name, not a verified env ID.
// Fill the actual environment ID and verify sharing/identity/security before enabling.
// Do not copy test data or re-use its cached queue when switching collections/environments.
module.exports = {
  enabled: false,
  envId: '',
  functionName: resources.apiFunction,
  storageNamespace: 'jiancheng_daka'
};
