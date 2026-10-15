'use strict';
const cloud = require('wx-server-sdk');
const { createSupervisionRepository } = require('./lib/supervision-repository');
const { createMediaProvider } = require('./lib/media-provider');
const { createMediaWorker } = require('./lib/media-worker');
const { authorizeTimer } = require('./lib/reminder-worker');
const { mediaConfiguration, mediaWorkerReady, mediaTimerSecret, MEDIA_TIMER_NAME } = require('./lib/supervision-gates');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
exports.main = async event => {
  const env = process.env;
  // Retain cleanup and review after the client entry is closed during rollback.
  if (!mediaWorkerReady(env)) {
    return { ok: false, code: 'NOT_ENABLED' };
  }
  try {
    if (!authorizeTimer(event, cloud.getWXContext(), mediaTimerSecret(env), MEDIA_TIMER_NAME)) return { ok: false, code: 'UNAUTHORIZED' };
    const provider = createMediaProvider(cloud, mediaConfiguration(env));
    return await createMediaWorker({ repository: createSupervisionRepository(cloud.database()), provider })();
  } catch (_) { return { ok: false, code: 'SERVICE_UNAVAILABLE' }; }
};
