'use strict';
const cloud = require('wx-server-sdk');
const { createPublicShareApi, PUBLIC_UNAVAILABLE } = require('./lib/features');
const { createFeaturesRepository } = require('./lib/features-repository');
const { businessEvent } = require('./lib/identity');
const { configuration, createLimitRepository, createLimiter } = require('./lib/limits');
const domain = require('./shared/habits');
const dates = require('./shared/date');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
let limiter;
exports.main = async event => {
  // Dedicated read-only entry. It must never route to the private account API.
  if (process.env.HABIT_PUBLIC_SHARES_ENABLED !== 'true' || process.env.HABIT_SIDECAR_CLEANUP_ENABLED !== 'true' || process.env.HABIT_LIMITS_VERIFIED !== 'true') return { ...PUBLIC_UNAVAILABLE };
  try {
    if (!limiter) limiter = createLimiter({ repository: createLimitRepository(cloud.database()), scope: 'public', limits: configuration(process.env, 'HABIT_PUBLIC_LIMIT', false) });
    return await createPublicShareApi({ repository: createFeaturesRepository(cloud.database()), domain, dates, limiter })(businessEvent(event));
  }
  catch (_) { return { ...PUBLIC_UNAVAILABLE }; }
};
