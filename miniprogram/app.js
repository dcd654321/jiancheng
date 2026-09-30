const { createCloudSession } = require('./services/cloud-session');
const cloudConfig = require('./config/cloud');
const appearanceConfig = require('./config/appearance');
const { createWorkspaceStore } = require('./services/workspace-store');
const { createPlanAssistant } = require('./services/plan-assistant');
const aiConfig = require('./config/ai');
const { createQuoteSession } = require('./services/quotes');
const { createAppLifecycle } = require('./services/app-lifecycle');
const { createAppearanceClient } = require('./services/appearance-client');
const { createAppearanceController } = require('./services/appearance');

const lifecycle = createAppLifecycle({
  wxApi: wx,
  cloudConfig,
  aiConfig,
  appearanceConfig,
  createCloudSession,
  createWorkspaceStore,
  createPlanAssistant,
  createQuoteSession,
  createAppearanceClient,
  createAppearanceController
});

App({
  onLaunch() { return lifecycle.onLaunch(this); },
  onShow() { return lifecycle.onShow(this); },
  onHide() { return lifecycle.onHide(this); }
});
