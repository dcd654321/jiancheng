const { createCloudSession } = require('./services/cloud-session');
const cloudConfig = require('./config/cloud');
const appearanceConfig = require('./config/appearance');
const { createWorkspaceStore } = require('./services/workspace-store');
const { createQuoteSession } = require('./services/quotes');
const { createAppLifecycle } = require('./services/app-lifecycle');
const { createAppearanceClient } = require('./services/appearance-client');
const { createAppearanceController } = require('./services/appearance');
const { createOperationsMonitor } = require('./services/operations-monitor');

const lifecycle = createAppLifecycle({
  wxApi: wx,
  cloudConfig,
  appearanceConfig,
  createCloudSession,
  createWorkspaceStore,
  createQuoteSession,
  createAppearanceClient,
  createAppearanceController,
  createOperationsMonitor
});

App({
  onLaunch() { return lifecycle.onLaunch(this); },
  onShow() { return lifecycle.onShow(this); },
  onHide() { return lifecycle.onHide(this); }
});
