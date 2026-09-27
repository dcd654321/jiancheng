'use strict';
const cloud = require('wx-server-sdk');
const { createFeaturesApi } = require('./lib/features');
const { createFeaturesRepository } = require('./lib/features-repository');
const { businessEvent } = require('./lib/identity');
const { configuration, createLimitRepository, createLimiter } = require('./lib/limits');
const domain = require('./shared/habits');
const dates = require('./shared/date');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
let limiter;
exports.main = async event => {
  if (process.env.HABIT_FEATURES_ENABLED !== 'true' || process.env.HABIT_IDENTITY_VERIFIED !== 'true' ||
    process.env.HABIT_SIDECAR_CLEANUP_ENABLED !== 'true' || process.env.HABIT_LIMITS_VERIFIED !== 'true' ||
    process.env.HABIT_MINIPROGRAM_ONLY !== 'true' || !process.env.HABIT_APP_ID) {
    return { ok: false, code: 'NOT_ENABLED', message: '分享与偏好服务尚未开放' };
  }
  try {
    if (!limiter) limiter = createLimiter({ repository: createLimitRepository(cloud.database()), scope: 'features', limits: configuration(process.env, 'HABIT_FEATURES_LIMIT') });
    return await createFeaturesApi({ repository: createFeaturesRepository(cloud.database()), domain, dates,
      limiter, allowedAppId: process.env.HABIT_APP_ID, allowedSources: ['wx_client', 'wx_devtools'] })(businessEvent(event), cloud.getWXContext());
  } catch (_) { return { ok: false, code: 'SERVICE_UNAVAILABLE', message: '服务暂不可用，请稍后重试' }; }
};
