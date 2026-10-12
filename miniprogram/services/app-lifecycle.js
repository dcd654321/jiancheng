'use strict';
const { createNetworkRecovery } = require('./network-recovery');
const { createNoteDrafts } = require('./note-drafts');
const { createFormDrafts } = require('./form-drafts');

function monitorCall(app, method, ...args) {
  try {
    const monitor = app.operationsMonitor;
    const result = monitor && typeof monitor[method] === 'function' ? monitor[method](...args) : undefined;
    if (result && typeof result.then === 'function') void Promise.resolve(result).catch(() => {});
    return result;
  } catch (_) { return undefined; }
}

function createAppLifecycle(dependencies) {
  const d = dependencies;

  function settle(app, work) {
    app.dataReady = Promise.resolve(work).catch(() => app.cloudSession.status());
    return app.dataReady;
  }

  // 主题读取与核心数据并行：失败或延迟只影响颜色，不阻塞习惯读取。
  function readAppearance(app) {
    if (!app.appearanceController) return null;
    try { return app.appearanceController.ensureRead(); } catch (_) { return null; }
  }

  return {
    onLaunch(app) {
      monitorCall(app, 'dispose');
      app.operationsMonitor = null;
      if (app.appearanceController && app.appearanceController.dispose) app.appearanceController.dispose();
      if (app.networkRecovery) app.networkRecovery.dispose();
      app.cloudSession = d.createCloudSession(d.wxApi, d.cloudConfig, undefined,
        { sessionId: () => { const context = monitorCall(app, 'capture'); return context && context.sessionId; } });
      app.noteDrafts = createNoteDrafts();
      app.formDrafts = createFormDrafts();
      app.store = d.createWorkspaceStore(app.cloudSession, app.noteDrafts);
      app.networkRecovery = createNetworkRecovery(d.wxApi, app.cloudSession);
      app.quoteSession = d.createQuoteSession();
      if (d.createOperationsMonitor) {
        try { app.operationsMonitor = d.createOperationsMonitor(d.wxApi, d.cloudConfig, {
          contextKey: () => {
            const status = app.cloudSession.status();
            return status.accountId && status.epoch && !status.deletionPending ? status.accountId + ':' + status.epoch : '';
          },
          accountGeneration: () => app.cloudSession.status().epoch,
          subscribe: listener => app.cloudSession.subscribe(listener)
        }); } catch (_) { app.operationsMonitor = null; }
      }
      if (d.createAppearanceClient && d.createAppearanceController) {
        app.appearanceClient = d.createAppearanceClient(d.wxApi, d.cloudConfig, d.appearanceConfig, app.cloudSession,
          { contextKey: () => app.store.contextKey() });
        app.appearanceController = d.createAppearanceController({ client: app.appearanceClient, wxApi: d.wxApi, session: app.cloudSession });
      }
      readAppearance(app);
      return settle(app, app.cloudSession.start());
    },
    onShow(app) {
      if (!app.cloudSession) return Promise.resolve(null);
      monitorCall(app, 'onShow');
      if (app.networkRecovery) app.networkRecovery.onShow();
      const work = settle(app, Promise.resolve(app.dataReady).then(() => app.cloudSession.onForeground()));
      // 主题读取与前台恢复并行触发，不改动本方法的既有返回值。
      return work.then(result => { monitorCall(app, 'onReady'); readAppearance(app); return result; });
    },
    onHide(app) { monitorCall(app, 'onHide'); if (app.networkRecovery) app.networkRecovery.onHide(); }
  };
}

module.exports = { createAppLifecycle };
