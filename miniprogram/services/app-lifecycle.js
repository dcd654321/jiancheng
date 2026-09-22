'use strict';
const { createNetworkRecovery } = require('./network-recovery');
const { createNoteDrafts } = require('./note-drafts');

function createAppLifecycle(dependencies) {
  const d = dependencies;

  function settle(app, work) {
    app.dataReady = Promise.resolve(work).catch(() => app.cloudSession.status());
    return app.dataReady;
  }

  return {
    onLaunch(app) {
      if (app.networkRecovery) app.networkRecovery.dispose();
      app.cloudSession = d.createCloudSession(d.wxApi, d.cloudConfig);
      app.noteDrafts = createNoteDrafts();
      app.store = d.createWorkspaceStore(d.createStore(d.wxApi), app.cloudSession, app.noteDrafts);
      app.networkRecovery = createNetworkRecovery(d.wxApi, app.cloudSession);
      app.planAssistant = d.createPlanAssistant(d.wxApi, d.cloudConfig, d.aiConfig);
      app.quoteSession = d.createQuoteSession(d.wxApi);
      return settle(app, app.cloudSession.start());
    },
    onShow(app) {
      if (!app.cloudSession) return Promise.resolve(null);
      if (app.networkRecovery) app.networkRecovery.onShow();
      return settle(app, Promise.resolve(app.dataReady).then(() => app.cloudSession.onForeground()));
    },
    onHide(app) { if (app.networkRecovery) app.networkRecovery.onHide(); }
  };
}

module.exports = { createAppLifecycle };
