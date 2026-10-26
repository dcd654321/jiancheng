'use strict';
const { createNetworkRecovery } = require('./network-recovery');
const { createNoteDrafts } = require('./note-drafts');
const { createFormDrafts } = require('./form-drafts');
const { createSearchAttribution, publicRoute, sceneValue } = require('./search-attribution');

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
    onLaunch(app, options = {}) {
      app._foreground = false;
      app._accountVisitActive = false;
      app._accountVisitGeneration = 0;
      app._accountStarted = false;
      app._connectionPrepared = false;
      app._coreContentRendered = false;
      app._coreContext = '';
      app.onCoreContentRendered = () => {
        if (!app._foreground || contentIsCurrent(app) || (app.searchAttribution && app.searchAttribution.isCrawler())) return;
        app._coreContentRendered = true;
        app._coreContext = app.store && app.store.contextKey ? app.store.contextKey() : '';
        monitorCall(app, 'onShow');
        monitorCall(app, 'onReady');
        readAppearance(app);
      };
      monitorCall(app, 'dispose');
      app.operationsMonitor = null;
      if (app.searchAttribution) app.searchAttribution.dispose();
      if (app.appearanceController && app.appearanceController.dispose) app.appearanceController.dispose();
      if (app.networkRecovery) app.networkRecovery.dispose();
      app.cloudSession = d.createCloudSession(d.wxApi, d.cloudConfig, undefined,
        { onTiming: d.onStartupTiming,
          sessionId: () => { const context = monitorCall(app, 'capture'); return context && context.sessionId; },
          searchSource: () => app.searchAttribution && app.searchAttribution.capture() });
      app.searchAttribution = createSearchAttribution({ session: app.cloudSession });
      app.searchAttribution.onLaunch(options);
      const publicLaunch = !!publicRoute(options.path) || sceneValue(options.scene) === 1129;
      const prepareConnection = () => {
        if (app._connectionPrepared || !d.prepareCloudConnection || app.cloudSession.status().configured === false) return;
        app._connectionPrepared = true;
        try { Promise.resolve(d.prepareCloudConnection(d.wxApi, d.cloudConfig, { onTiming: d.onStartupTiming })).catch(() => {}); }
        catch (_) { /* Core reading reports connection errors through its normal recovery path. */ }
      };
      if (!publicLaunch) prepareConnection();
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
      // All private entry points share this one initialization. Public content
      // never calls it, including when account/network services are unavailable.
      app.ensureAccountReady = () => {
        if (app.searchAttribution.isCrawler()) return Promise.resolve(app.cloudSession.status());
        if (app._foreground && app.networkRecovery) app.networkRecovery.onShow();
        if (app._accountVisitActive) return app.dataReady || Promise.resolve(app.cloudSession.status());
        app._accountVisitActive = true;
        const visitGeneration = ++app._accountVisitGeneration;
        prepareConnection();
        if (!app._accountStarted) { app._accountStarted = true; return settle(app, app.cloudSession.start()); }
        return settle(app, Promise.resolve(app.dataReady).then(() => {
          if (!app._foreground || !app._accountVisitActive || visitGeneration !== app._accountVisitGeneration) return app.cloudSession.status();
          return app.cloudSession.onForeground();
        }));
      };
      app.onPublicContentShown = () => {
        app._accountVisitActive = false; app._coreContentRendered = false; app._accountVisitGeneration += 1;
        monitorCall(app, 'onHide');
        if (app.networkRecovery) app.networkRecovery.onHide();
      };
      if (publicLaunch) return settle(app, app.cloudSession.status());
      return app.ensureAccountReady();
    },
    onShow(app, options = {}) {
      if (!app.cloudSession) return Promise.resolve(null);
      app._foreground = true;
      app._coreContentRendered = false;
      app.searchAttribution.onShow(options);
      // The first foreground belongs to launch, including a failed launch read.
      // Retrying it immediately doubles the waiting instead of offering recovery.
      if (publicRoute(options.path) || app.searchAttribution.isCrawler()) {
        app.onPublicContentShown();
        return Promise.resolve(app.cloudSession.status());
      }
      return app.ensureAccountReady();
    },
    onHide(app) {
      app._foreground = false; app._coreContentRendered = false; app._accountVisitActive = false; app._accountVisitGeneration += 1;
      monitorCall(app, 'onHide'); if (app.networkRecovery) app.networkRecovery.onHide();
    }
  };
}

module.exports = { createAppLifecycle };
