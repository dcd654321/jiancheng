'use strict';
const cloud = require('wx-server-sdk');
const { createApi } = require('./lib/handler');
const { createRepository } = require('./lib/cloudbase-repository');
const domain = require('./shared/habits');
const dates = require('./shared/date');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async event => {
  // Disabled by default. Configure only after verifying Mini Program-only invocation and the database deny-client rules.
  if (process.env.HABIT_API_ENABLED !== 'true' || process.env.HABIT_MINIPROGRAM_ONLY !== 'true' || !process.env.HABIT_APP_ID) {
    return { ok: false, code: 'NOT_ENABLED', message: '云同步尚未配置完成，本机功能不受影响' };
  }
  const handle = createApi({ repository: createRepository(cloud.database()), domain, dates,
    allowedAppId: process.env.HABIT_APP_ID, allowedSources: ['wx_client', 'wx_devtools'] });
  // The WeChat/CloudBase invocation adds userInfo and tcbContext to event.
  // These are transport metadata,
  // never an identity source or part of the business request fingerprint.
  // Preserve malformed inputs and all other keys for strict protocol validation.
  let request = event;
  if (event && typeof event === 'object' && !Array.isArray(event) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(event))) {
    const { userInfo: ignoredUserInfo, tcbContext: ignoredTcbContext, ...businessEvent } = event;
    request = businessEvent;
  }
  return handle(request, cloud.getWXContext());
};
