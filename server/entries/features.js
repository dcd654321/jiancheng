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
// 共同安全前提默认视为已就绪（身份、来源、限流、旁路清理在代码层无条件执行）；
// 这些开关只用于部署期回退——显式设为 'false' 即恢复“未确认即停服”。
// 分享/提醒/AI 的开关保持必填且默认关闭：打开主题不会连带开放其他能力。
const COMMON_GATES = ['HABIT_IDENTITY_VERIFIED', 'HABIT_SIDECAR_CLEANUP_ENABLED', 'HABIT_LIMITS_VERIFIED', 'HABIT_MINIPROGRAM_ONLY'];
const APPEARANCE_ACTIONS = ['getAppearance', 'setAppearance'];
const disabled = key => process.env[key] === 'false';
// features 函数限流默认值（代码内置，部署无需配置数字；HABIT_FEATURES_LIMIT_* 仍可覆盖）：
// 全体每分钟60/每天2000，单账户每分钟30/每天300——远超任何正常使用量，仅用于防刷封顶。
const FEATURES_LIMIT_DEFAULTS = Object.freeze({ minute: 60, day: 2000, userMinute: 30, userDay: 300 });
let limiter;
let reminderLimiter;
exports.main = async event => {
  if (COMMON_GATES.some(disabled)) return { ok: false, code: 'NOT_ENABLED', message: '服务尚未开放' };
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
