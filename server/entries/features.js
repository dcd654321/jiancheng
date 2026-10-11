'use strict';
const cloud = require('wx-server-sdk');
const { createFeaturesApi } = require('./lib/features');
const { createFeaturesRepository } = require('./lib/features-repository');
const { businessEvent } = require('./lib/identity');
const { configuration, createLimitRepository, createLimiter } = require('./lib/limits');
const { FIELDS, createReminderApi, createReminderRepository, createRecipientCodec } = require('./lib/reminders');
const domain = require('./shared/habits');
const dates = require('./shared/date');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

// 本小程序 AppID（公开值，非密钥）：未配置 HABIT_APP_ID 时的默认绑定。
// 身份仍只来自受信平台上下文（FROM_APPID/FROM_OPENID/SOURCE），客户端字段不参与认证。
const DEFAULT_APP_ID = 'wx58e61dffcbfa4249';
// 删除偏好与私有限流数据依赖核心 API 的显式清理配置；两端均须确认开启。
const REQUIRED_CLEANUP_GATES = ['HABIT_SIDECAR_CLEANUP_ENABLED', 'HABIT_LIMITS_VERIFIED'];
// 身份与来源仍按受信上下文校验；显式 false 用于部署期回退。
const COMMON_GATES = ['HABIT_IDENTITY_VERIFIED', 'HABIT_MINIPROGRAM_ONLY'];
// 分享和提醒开关保持必填且默认关闭：打开主题不会连带开放其他能力。
const APPEARANCE_ACTIONS = ['getAppearance', 'setAppearance'];
const disabled = key => process.env[key] === 'false';
// features 函数限流默认值（代码内置，部署无需配置数字；HABIT_FEATURES_LIMIT_* 仍可覆盖）：
// 全体每分钟60/每天2000，单账户每分钟30/每天300——远超任何正常使用量，仅用于防刷封顶。
const FEATURES_LIMIT_DEFAULTS = Object.freeze({ minute: 60, day: 2000, userMinute: 30, userDay: 300 });
let limiter;
let reminderLimiter;
exports.main = async event => {
  if (REQUIRED_CLEANUP_GATES.some(key => process.env[key] !== 'true') || COMMON_GATES.some(disabled)) {
    return { ok: false, code: 'NOT_ENABLED', message: '服务尚未开放' };
  }
  try {
    const request = businessEvent(event);
    if (request && APPEARANCE_ACTIONS.includes(request.action)) {
      if (disabled('HABIT_APPEARANCE_ENABLED')) return { ok: false, code: 'NOT_ENABLED', message: '外观主题服务尚未开放' };
    } else {
      if (process.env.HABIT_FEATURES_ENABLED !== 'true') return { ok: false, code: 'NOT_ENABLED', message: '分享与偏好服务尚未开放' };
      if (request && Object.prototype.hasOwnProperty.call(FIELDS, request.action)) {
        if (['HABIT_REMINDERS_ENABLED', 'HABIT_REMINDER_STORAGE_READY', 'HABIT_TEMPLATE_VERIFIED', 'HABIT_TIMER_VERIFIED', 'HABIT_REMINDER_TTL_VERIFIED'].some(k => process.env[k] !== 'true')) return { ok: false, code: 'NOT_ENABLED', message: '提醒服务尚未开放' };
        const codec = createRecipientCodec(process.env.HABIT_REMINDER_KEY);
        if (!reminderLimiter) reminderLimiter = createLimiter({ repository: createLimitRepository(cloud.database()), scope: 'reminders', limits: configuration(process.env, 'HABIT_REMINDERS_LIMIT') });
        return await createReminderApi({ repository: createReminderRepository(cloud.database()), domain, dates, codec, limiter: reminderLimiter,
          templateId: process.env.HABIT_REMINDER_TEMPLATE, allowedAppId: process.env.HABIT_APP_ID || DEFAULT_APP_ID, allowedSources: ['wx_client', 'wx_devtools'] })(request, cloud.getWXContext());
      }
    }
    if (!limiter) limiter = createLimiter({ repository: createLimitRepository(cloud.database()), scope: 'features', limits: configuration(process.env, 'HABIT_FEATURES_LIMIT', true, FEATURES_LIMIT_DEFAULTS) });
    return await createFeaturesApi({ repository: createFeaturesRepository(cloud.database()), domain, dates,
      limiter, allowedAppId: process.env.HABIT_APP_ID || DEFAULT_APP_ID, allowedSources: ['wx_client', 'wx_devtools'] })(request, cloud.getWXContext());
  } catch (_) { return { ok: false, code: 'SERVICE_UNAVAILABLE', message: '服务暂不可用，请稍后重试' }; }
};
