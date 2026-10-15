'use strict';
const cloud = require('wx-server-sdk');
const { createSupervisionRepository } = require('./lib/supervision-repository');
const { createMediaProvider } = require('./lib/media-provider');
const { createMediaCallback } = require('./lib/media-worker');
const { mediaConfiguration, mediaCallbackReady } = require('./lib/supervision-gates');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
exports.main = async event => {
  // This endpoint accepts only the encrypted, signed platform callback. It is not a client API.
  if (!mediaCallbackReady(process.env)) {
    return { statusCode: 503, headers: { 'Content-Type': 'text/plain' }, body: 'unavailable' };
  }
  try {
    const provider = createMediaProvider(cloud, mediaConfiguration(process.env));
    let verified;
    try { verified = provider.verifyCallback(event); }
    catch (_) { return { statusCode: 401, headers: { 'Content-Type': 'text/plain' }, body: 'invalid callback' }; }
    if (verified.handshake) return { statusCode: 200, headers: { 'Content-Type': 'text/plain' }, body: verified.echo };
    return await createMediaCallback({ repository: createSupervisionRepository(cloud.database()), provider })(event);
  } catch (_) { return { statusCode: 503, headers: { 'Content-Type': 'text/plain' }, body: 'unavailable' }; }
};
