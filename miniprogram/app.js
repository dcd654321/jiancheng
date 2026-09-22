const { createStore } = require('./services/store');
const { createCloudSession } = require('./services/cloud-session');
const cloudConfig = require('./config/cloud');
const { createWorkspaceStore } = require('./services/workspace-store');
const { createPlanAssistant } = require('./services/plan-assistant');
const aiConfig = require('./config/ai');
const { createQuoteSession } = require('./services/quotes');
const { createAppLifecycle } = require('./services/app-lifecycle');

const lifecycle = createAppLifecycle({
  wxApi: wx,
  cloudConfig,
  aiConfig,
  createStore,
  createCloudSession,
  createWorkspaceStore,
  createPlanAssistant,
  createQuoteSession
});

App({
  onLaunch() { return lifecycle.onLaunch(this); },
  onShow() { return lifecycle.onShow(this); },
  onHide() { return lifecycle.onHide(this); }
});
