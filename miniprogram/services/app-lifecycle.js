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

  function contentIsCurrent(app) {
    const context = app.store && typeof app.store.contextKey === 'function' ? app.store.contextKey() : '';
    return app._foreground && app._coreContentRendered && app._coreContext === context;
  }

  // Optional remote work starts after an authoritative page has painted.
  function readAppearance(app) {
    if (!app.appearanceController) return null;
    try {
      const work = app.appearanceController.ensureRead();
      if (work && typeof work.then === 'function') void Promise.resolve(work).catch(() => {});
      return work;
    } catch (_) { return null; }
  }

  return {
    onLaunch(app) {
      app._initialShow = true;
      app._foreground = false;
      app._coreContentRendered = false;
      app._coreContext = '';
      app.onCoreContentRendered = () => {
        if (!app._foreground || contentIsCurrent(app)) return;
        app._coreContentRendered = true;
        app._coreContext = app.store && app.store.contextKey ? app.store.contextKey() : '';
        monitorCall(app, 'onShow');
        monitorCall(app, 'onReady');
        readAppearance(app);
      };
      monitorCall(app, 'dispose');
      app.operationsMonitor = null;
      if (app.appearanceController && app.appearanceController.dispose) app.appearanceController.dispose();
      if (app.networkRecovery) app.networkRecovery.dispose();
      app.cloudSession = d.createCloudSession(d.wxApi, d.cloudConfig, undefined,
        { onTiming: d.onStartupTiming,
          sessionId: () => { const context = monitorCall(app, 'capture'); return context && context.sessionId; } });
      if (d.prepareCloudConnection && app.cloudSession.status().configured !== false) {
        try {
          Promise.resolve(d.prepareCloudConnection(d.wxApi, d.cloudConfig, { onTiming: d.onStartupTiming })).catch(() => {});
        } catch (_) { /* Core reading reports connection errors through its normal recovery path. */ }
      }
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
          subscribe: listener => app.cloudSession.subscribe(() => { if (contentIsCurrent(app)) listener(); })
        }); } catch (_) { app.operationsMonitor = null; }
      }
      if (d.createAppearanceClient && d.createAppearanceController) {
        try {
          app.appearanceClient = d.createAppearanceClient(d.wxApi, d.cloudConfig, d.appearanceConfig, app.cloudSession,
            { contextKey: () => app.store.contextKey() });
          const appearanceSession = {
            status: () => app.cloudSession.status(),
            subscribe: listener => app.cloudSession.subscribe(() => {
              if (contentIsCurrent(app)) listener();
            })
          };
          app.appearanceController = d.createAppearanceController({ client: app.appearanceClient, wxApi: d.wxApi, session: appearanceSession });
        } catch (_) { app.appearanceClient = null; app.appearanceController = null; }
      }
      return settle(app, app.cloudSession.start());
    },
    onShow(app) {
      if (!app.cloudSession) return Promise.resolve(null);
      app._foreground = true;
      app._coreContentRendered = false;
      if (app.networkRecovery) app.networkRecovery.onShow();
      // The first foreground belongs to launch, including a failed launch read.
      // Retrying it immediately doubles the waiting instead of offering recovery.
      const initialShow = app._initialShow;
      app._initialShow = false;
      const work = settle(app, initialShow ? app.dataReady : Promise.resolve(app.dataReady).then(() => app.cloudSession.onForeground()));
      return work;
    },
    onHide(app) {
      app._foreground = false; app._coreContentRendered = false;
      monitorCall(app, 'onHide'); if (app.networkRecovery) app.networkRecovery.onHide();
    }
  };
}

module.exports = { createAppLifecycle };
