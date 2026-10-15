'use strict';
const crypto = require('node:crypto');
const release = require('./supervision-config');
const SUPERVISION_ACTIONS = ['createSupervisionInvite', 'getSupervisionInvite', 'applySupervision', 'confirmSupervision',
  'listSupervisions', 'getSupervision', 'endSupervision', 'updateSupervision', 'encourageSupervision'];
const MEDIA_ACTIONS = ['prepareMedia', 'confirmMedia', 'getRecordMedia', 'updateRecordMedia'];
const COMMON = ['HABIT_IDENTITY_VERIFIED', 'HABIT_MINIPROGRAM_ONLY', 'HABIT_SIDECAR_CLEANUP_ENABLED', 'HABIT_LIMITS_VERIFIED'];
const all = (env, keys) => keys.every(key => env[key] === 'true');
const DEFAULT_APP_ID = 'wx58e61dffcbfa4249';
const MEDIA_TIMER_NAME = 'jiancheng_daka_media_tick';
const filePrefixValid = value => typeof value === 'string' && /^cloud:\/\/[A-Za-z0-9_.-]+\/$/.test(value);
const aesKeyValid = value => typeof value === 'string' && /^[A-Za-z0-9+/]{43}$/.test(value) &&
  Buffer.from(value+'=','base64').toString('base64').slice(0,-1) === value;
const callbackCredentialsReady = env => typeof env.HABIT_MEDIA_CALLBACK_TOKEN === 'string' &&
  /^[A-Za-z0-9_-]{16,128}$/.test(env.HABIT_MEDIA_CALLBACK_TOKEN) && aesKeyValid(env.HABIT_MEDIA_ENCODING_AES_KEY);
const supervisionReady = env => release.storageReady === true && release.supervisionEnabled === true && all(env, COMMON);
const mediaReady = env => release.storageReady === true && release.mediaEnabled === true && all(env, COMMON) &&
  filePrefixValid(env.HABIT_MEDIA_FILE_ID_PREFIX) && callbackCredentialsReady(env);
// Closing entry points never removes enforcement or old-generation cleanup.
const recordGuardReady = () => release.storageReady === true;
const mediaCallbackReady = env => recordGuardReady() && env.HABIT_IDENTITY_VERIFIED === 'true' && callbackCredentialsReady(env);
const mediaWorkerReady = env => mediaCallbackReady(env) && env.HABIT_SIDECAR_CLEANUP_ENABLED === 'true' && filePrefixValid(env.HABIT_MEDIA_FILE_ID_PREFIX);
function supervisorReminderConfiguration(env) {
  const templateId = env.HABIT_SUPERVISOR_TEMPLATE;
  if (typeof templateId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(templateId) || templateId === env.HABIT_REMINDER_TEMPLATE) return null;
  try {
    const fields = JSON.parse(env.HABIT_SUPERVISOR_FIELDS || 'null');
    if (!fields || !/^thing[1-9]\d?$/.test(fields.text || '') || !/^number[1-9]\d?$/.test(fields.count || '') || !/^time[1-9]\d?$/.test(fields.time || '')) return null;
    return { templateId, fields };
  } catch (_) { return null; }
}
const supervisorReminderReady = env => supervisionReady(env) && release.supervisorRemindersEnabled === true && supervisorReminderConfiguration(env) !== null;
function mediaTimerSecret(env) {
  if (!aesKeyValid(env.HABIT_MEDIA_ENCODING_AES_KEY)) throw Error('MEDIA_TIMER_CONFIG_REQUIRED');
  return crypto.createHmac('sha256',Buffer.from(env.HABIT_MEDIA_ENCODING_AES_KEY+'=','base64'))
    .update('jiancheng_daka_media_tick:timer-auth:v1').digest('hex');
}
function mediaConfiguration(env) {
  return { fileIdPrefix: env.HABIT_MEDIA_FILE_ID_PREFIX, appId: env.HABIT_APP_ID || DEFAULT_APP_ID,
    callbackToken: env.HABIT_MEDIA_CALLBACK_TOKEN, encodingAESKey: env.HABIT_MEDIA_ENCODING_AES_KEY };
}
module.exports = { SUPERVISION_ACTIONS, MEDIA_ACTIONS, COMMON, MEDIA_TIMER_NAME,
  supervisionReady, mediaReady, recordGuardReady, mediaConfiguration, mediaCallbackReady, mediaWorkerReady,
  supervisorReminderReady, supervisorReminderConfiguration, mediaTimerSecret };
