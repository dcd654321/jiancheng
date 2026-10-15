const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { fixture } = require('./helpers/cloud-fixture.cjs');
const { createCloudSession } = require('../miniprogram/services/cloud-session');
const { createWorkspaceStore } = require('../miniprogram/services/workspace-store');
const { createAppLifecycle } = require('../miniprogram/services/app-lifecycle');
const { createAppearanceController } = require('../miniprogram/services/appearance');
const config = require('../miniprogram/config/cloud');
const flush = () => new Promise(resolve => setImmediate(resolve));

async function harness(t, route) {
  const f = fixture(), remote = [], frames = [];
  let release, pullCalls = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const wxApi = {};
  const lifecycle = createAppLifecycle({ wxApi, cloudConfig: config, appearanceConfig: { enabled: true },
    createCloudSession: (wx, target, _factory, options) => createCloudSession(wx, target, () => async event => {
      pullCalls++; await gate; return f.api(event);
    }, options), createWorkspaceStore, createQuoteSession: () => ({}),
    createOperationsMonitor: () => ({ onShow() { remote.push('monitor'); }, onReady() {}, onHide() {} }),
    createAppearanceClient: (_wx, _config, _appearance, session) => ({
      status: () => ({ enabled: true, contextKey: session.status().accountId + ':' + session.status().epoch }),
      contextKey() { if (!session.status().ready) throw Error('ACCOUNT_NOT_READY'); return this.status().contextKey; },
      invalidate() {},
      async read() { remote.push('appearance'); return { theme: 'mist', revision: 0 }; }
    }), createAppearanceController
  });
  const app = {}, previous = { wx: global.wx, getApp: global.getApp, Page: global.Page };
  global.wx = wxApi; global.getApp = () => app;
  lifecycle.onLaunch(app); lifecycle.onShow(app);
  let definition; global.Page = value => { definition = value; };
  const file = path.resolve(__dirname, '../miniprogram/pages/' + route + '/index.js');
  delete require.cache[file]; require(file);
  const page = { ...definition, data: structuredClone(definition.data),
    setData(patch, callback) { Object.assign(this.data, patch); if (callback) frames.push(callback); }
  };
  t.after(async () => {
    release(); await app.dataReady; await flush(); page.onUnload(); lifecycle.onHide(app);
    if (app.appearanceController) app.appearanceController.dispose();
    Object.assign(global, previous);
  });
  if (page.onLoad) page.onLoad({}); page.onShow();
  return { app, page, lifecycle, remote, frames, release, pullCalls: () => pullCalls,
    paint() { const callbacks = frames.splice(0); callbacks.forEach(callback => callback()); } };
}

for (const route of ['today', 'sync', 'appearance']) test(route + ': real account/store waits for the rendering callback before optional requests', async t => {
  const h = await harness(t, route);
  assert.equal(h.app.store.info().busy, true);
  assert.ok(h.app.store.info().lastAttemptAt > 0);
  h.paint(); assert.deepEqual(h.remote, []);
  h.release(); await h.app.dataReady; await flush();
  assert.equal(h.app.store.info().busy, false); assert.deepEqual(h.remote, []);
  h.paint(); await flush();
  assert.equal(h.remote.filter(event => event === 'monitor').length, 1);
  assert.equal(h.remote.filter(event => event === 'appearance').length, 1);
  h.paint(); await flush(); assert.equal(h.remote.length, 2);
});

test('a rendered callback from a hidden visit cannot start optional work in the next visit', async t => {
  const h = await harness(t, 'today');
  h.release(); await h.app.dataReady; await flush();
  const staleFrames = h.frames.splice(0);
  h.page.onHide(); h.lifecycle.onHide(h.app);
  await h.lifecycle.onShow(h.app); h.page.onShow();
  staleFrames.forEach(callback => callback()); assert.deepEqual(h.remote, []);
  h.paint(); await flush(); assert.deepEqual(h.remote, ['monitor', 'appearance']);
  assert.equal(h.pullCalls(), 1, 'the same fresh account is reused after returning');
});

test('the real workspace adapter exposes pending reads while retaining confirmed content', async t => {
  const h = await harness(t, 'today');
  h.release(); await h.app.dataReady; await flush(); h.paint(); await flush();
  const work = h.app.cloudSession.refresh();
  h.page.refresh();
  assert.equal(h.app.store.info().busy, true); assert.ok(h.app.store.info().lastAttemptAt > 0);
  assert.equal(h.page.data.loading, false); assert.equal(h.page.data.dataReady, true);
  assert.equal(h.page.data.readRefreshing, true);
  await work; await flush(); assert.equal(h.page.data.readRefreshing, false);
});
