'use strict';
const { createNetworkRecovery } = require('./network-recovery');
const { createNoteDrafts } = require('./note-drafts');

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
      if (app.networkRecovery) app.networkRecovery.dispose();
      app.cloudSession = d.createCloudSession(d.wxApi, d.cloudConfig);
      app.noteDrafts = createNoteDrafts();
      app.store = d.createWorkspaceStore(app.cloudSession, app.noteDrafts);
      app.networkRecovery = createNetworkRecovery(d.wxApi, app.cloudSession);
      app.planAssistant = d.createPlanAssistant(d.wxApi, d.cloudConfig, d.aiConfig, { session: app.cloudSession });
      app.quoteSession = d.createQuoteSession();
      if (d.createAppearanceClient && d.createAppearanceController) {
        app.appearanceClient = d.createAppearanceClient(d.wxApi, d.cloudConfig, d.appearanceConfig, app.cloudSession);
        app.appearanceController = d.createAppearanceController({ client: app.appearanceClient, wxApi: d.wxApi, session: app.cloudSession });
      }
      readAppearance(app);
      return settle(app, app.cloudSession.start());
    },
    onShow(app) {
      if (!app.cloudSession) return Promise.resolve(null);
      if (app.networkRecovery) app.networkRecovery.onShow();
      const work = settle(app, Promise.resolve(app.dataReady).then(() => app.cloudSession.onForeground()));
      // 主题读取与前台恢复并行触发，不改动本方法的既有返回值。
      return work.then(result => { readAppearance(app); return result; });
    },
    onHide(app) { if (app.networkRecovery) app.networkRecovery.onHide(); }
  };
}

module.exports = { createAppLifecycle };
