'use strict';
const cloud = require('wx-server-sdk');
const { createApi } = require('./lib/handler');
const { createRepository } = require('./lib/cloudbase-repository');
const { businessEvent } = require('./lib/identity');
const { createOperationsReporter, createOperationsCleanup } = require('./lib/operations-monitor');
const domain = require('./shared/habits');
const dates = require('./shared/date');
const { recordGuardReady, mediaConfiguration } = require('./lib/supervision-gates');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async event => {
  // Disabled by default. Configure only after verifying Mini Program-only invocation and the database deny-client rules.
  if (process.env.HABIT_API_ENABLED !== 'true' || process.env.HABIT_MINIPROGRAM_ONLY !== 'true' || !process.env.HABIT_APP_ID) {
    return { ok: false, code: 'NOT_ENABLED', message: '云端服务尚未配置完成，请稍后再试' };
  }
  try {
    const db = cloud.database();
    const guardReady = recordGuardReady();
    let mutationGuard;
    const handle = createApi({ repository: createRepository(db, { supervisionEnabled: guardReady }), domain, dates,
      recordMutationGuard: guardReady ? (...args) => {
        if (!mutationGuard) mutationGuard = require('./lib/media').createRecordMutationGuard({ domain, dates });
        return mutationGuard(...args);
      } : null,
      reportOperations: createOperationsReporter(db), monitorLogger: code => console.warn(code),
      cleanup: async (owner, epoch, identity) => {
        if (process.env.HABIT_SIDECAR_CLEANUP_ENABLED === 'true') {
          const sidecarCleanup = require('./lib/sidecar-cleanup').createSidecarCleanup(db,
            { remindersEnabled: process.env.HABIT_REMINDER_STORAGE_READY === 'true', limitsEnabled: process.env.HABIT_LIMITS_VERIFIED === 'true', aiEnabled: process.env.HABIT_AI_STORAGE_READY === 'true' });
          await sidecarCleanup(owner, epoch);
          if (guardReady) {
            const provider = require('./lib/media-provider').createMediaProvider(cloud, mediaConfiguration(process.env));
            await require('./lib/media-worker').createSupervisionCleanup(db, provider)(owner, epoch);
          }
        }
        await createOperationsCleanup(db)(owner, epoch, identity);
      },
      allowedAppId: process.env.HABIT_APP_ID, allowedSources: ['wx_client', 'wx_devtools'] });
    // Ignore platform transport metadata, never treating it as authenticated identity.
    // Preserve malformed inputs and unknown business fields for strict validation.
    return await handle(businessEvent(event), cloud.getWXContext());
  } catch (_) {
    // SDK setup/context failures happen before the handler's error boundary.
    // Keep raw configuration, user identity and SDK diagnostics off the wire.
    return { ok: false, code: 'SERVICE_UNAVAILABLE', message: '云端服务暂不可用，请稍后重试确认' };
  }
};
