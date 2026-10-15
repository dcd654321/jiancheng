const { createCloudSession } = require('./services/cloud-session');
const cloudConfig = require('./config/cloud');
const appearanceConfig = require('./config/appearance');
const { createWorkspaceStore } = require('./services/workspace-store');
const { createQuoteSession } = require('./services/quotes');
const { createAppLifecycle } = require('./services/app-lifecycle');
const { prepareCloudConnection } = require('./services/cloud-transport');

const lifecycle = createAppLifecycle({
  wxApi: wx,
  cloudConfig,
  appearanceConfig,
  createCloudSession,
  createWorkspaceStore,
  createQuoteSession,
  prepareCloudConnection,
  createAppearanceClient(...args) { return require('./services/appearance-client').createAppearanceClient(...args); },
  createAppearanceController(...args) { return require('./services/appearance').createAppearanceController(...args); },
  createOperationsMonitor(...args) { return require('./services/operations-monitor').createOperationsMonitor(...args); },
  onStartupTiming(sample) { console.info('[jiancheng-startup]', JSON.stringify(sample)); }
});

App({
  onLaunch() { return lifecycle.onLaunch(this); },
  onShow() { return lifecycle.onShow(this); },
  onHide() { return lifecycle.onHide(this); }
});
