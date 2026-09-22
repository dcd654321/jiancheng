const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { fixture, storageFixture, dates } = require('./helpers/cloud-fixture.cjs');
const { createAppLifecycle } = require('../miniprogram/services/app-lifecycle');
const { createCloudSession } = require('../miniprogram/services/cloud-session');
const { createCloudBinding } = require('../miniprogram/services/cloud-binding');
const { createWorkspaceStore } = require('../miniprogram/services/workspace-store');
const { createStore } = require('../miniprogram/services/store');

async function boot({ fail = false } = {}) {
  const f = fixture(); f.date = dates.today(); await f.seed();
  const wxApi = storageFixture();
  const config = require('../miniprogram/config/cloud');
  createCloudBinding(wxApi, config.envId).accept();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const lifecycle = createAppLifecycle({
    wxApi, cloudConfig: config, aiConfig: {}, createStore, createWorkspaceStore,
    createCloudSession: (wx, c) => createCloudSession(wx, c, () => async event => {
      await gate;
      if (fail) throw Error('test network unavailable');
      return f.api(event);
    }),
    createPlanAssistant: () => ({}), createQuoteSession: () => ({ current: () => '测试短句' })
  });
  const app = {}; global.wx = wxApi; global.getApp = () => app;
  lifecycle.onLaunch(app); lifecycle.onShow(app);
  const pages = [];
  function page(name) {
    let definition;
    global.Page = value => { definition = value; };
    const source = path.resolve(__dirname, '../miniprogram/pages/' + name + '/index.js');
    delete require.cache[source]; require(source);
    const p = { ...definition, updates: 0, data: JSON.parse(JSON.stringify(definition.data)),
      setData(patch) { this.updates++; Object.assign(this.data, patch); } };
    pages.push(p); p.onShow(); return p;
  }
  return { app, page, release,
    async finish() { release(); await app.dataReady; await new Promise(resolve => setImmediate(resolve)); },
    cleanup() { for (const p of pages) p.onUnload(); }
  };
}

for (const name of ['today', 'progress', 'mine', 'sync']) {
  test(name + ': actual enabled config and delayed cold start refresh without manual intervention', async t => {
    const h = await boot(); t.after(() => h.cleanup());
    const p = h.page(name);
    assert.equal(p.data.loading, true);
    await h.finish();
    assert.equal(h.app.cloudSession.status().ready, true);
    assert.equal(p.data.loading, false);
    assert.equal(name === 'sync' ? p.data.ready : p.data.dataReady, true);
  });
}

test('failed cold start leaves loading and displays a retryable error', async t => {
  const h = await boot({ fail: true }); t.after(() => h.cleanup());
  const p = h.page('today');
  await h.finish();
  assert.equal(p.data.loading, false);
  assert.equal(p.data.dataUnavailable, true);
  assert.match(p.data.error, /test network unavailable/);
});

test('late startup never updates hidden or unloaded pages; returning displays current data', async t => {
  const h = await boot(); t.after(() => h.cleanup());
  const hidden = h.page('today'), unloaded = h.page('progress');
  hidden.onHide(); unloaded.onUnload();
  const hiddenUpdates = hidden.updates, unloadedUpdates = unloaded.updates;
  await h.finish();
  assert.equal(hidden.updates, hiddenUpdates);
  assert.equal(unloaded.updates, unloadedUpdates);
  hidden.onShow();
  assert.equal(hidden.data.dataReady, true);
});

test('a previous show callback cannot refresh a newer visible lifecycle', async t => {
  const h = await boot(); t.after(() => h.cleanup());
  const p = h.page('today');
  let refreshes = 0;
  const refresh = p.refresh;
  p.refresh = function() { refreshes++; return refresh.call(this); };
  p.onHide(); p.onShow();
  assert.equal(refreshes, 1);
  await h.finish();
  // One cloud-state notification plus the current show's readiness callback.
  // The previous show must still contribute no refresh.
  assert.equal(refreshes, 3);
  assert.equal(p.data.dataReady, true);
});
