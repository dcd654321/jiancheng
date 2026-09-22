// Read-only audit of current product modules. All account/storage/network data
// below are in-memory fixtures; this script never invokes WeChat or CloudBase.
const assert = require('node:assert/strict');
const path = require('node:path');
const root = path.resolve(__dirname, '../../..');
const { fixture, storageFixture, dates } = require(path.join(root, 'tests/helpers/cloud-fixture.cjs'));
const { createCloudSession } = require(path.join(root, 'miniprogram/services/cloud-session'));
const { createWorkspaceStore } = require(path.join(root, 'miniprogram/services/workspace-store'));
const { createStore } = require(path.join(root, 'miniprogram/services/store'));

function page(name, app) {
  global.getApp = () => app;
  let definition;
  global.Page = value => { definition = value; };
  const source = path.join(root, 'miniprogram/pages', name, 'index.js');
  delete require.cache[source]; require(source);
  return { ...definition, data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch) { Object.assign(this.data, patch); } };
}

async function run() {
  const evidence = {};
  const f = fixture(); f.date = dates.today(); await f.seed();
  let offline = true, calls = 0;
  const wx = storageFixture(); global.wx = wx;
  let listeners = 0;
  wx.onNetworkStatusChange = () => { listeners++; };
  const session = createCloudSession(wx, { enabled: true, envId: 'audit-memory' }, () => event => {
    calls++; if (offline) throw Error('audit offline'); return f.api(event);
  });
  await session.acceptConsent(true).catch(() => {});
  const sync = page('sync', { cloudSession: session }); sync.onShow();
  assert.equal(sync.data.dataUnavailable, true);
  const before = calls; offline = false;
  await sync.onRefresh();
  assert.equal(calls, before);
  assert.equal(session.status().ready, false);
  assert.match(sync.data.error, /请先阅读说明并同意连接/);
  evidence.retry = { reproduced: true, retryMadeNetworkCall: false, message: sync.data.error };
  await session.start();
  assert.equal(session.status().ready, true);

  const app = { cloudSession: session, store: createWorkspaceStore(createStore(wx), session) };
  const detail = page('detail', app); detail.onLoad({ id: 'read' }); detail.onShow();
  detail.onNote({ detail: { value: 'unsaved audit draft' } });
  const draft = detail.data.note;
  detail.onHide(); detail.onShow();
  assert.equal(detail.data.note, '');
  evidence.noteDraft = { reproduced: true, inputExisted: !!draft, lostAfterHideShow: true };
  detail.onUnload();

  offline = true;
  await session.refresh().catch(() => {});
  const offlineSync = page('sync', app); offlineSync.onShow();
  assert.equal(offlineSync.data.phase, 'offline');
  assert.equal(offlineSync.data.ready, true);
  assert.equal(offlineSync.data.pending, 0);
  evidence.offlineDisplayInputs = { ready: true, phase: offlineSync.data.phase,
    pending: 0, conflict: !!offlineSync.data.conflict, lastError: offlineSync.data.lastError };

  session.dispatch({ type: 'complete', id: 'read', date: f.date });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(session.status().pending, 1);
  const callsBeforeRecovery = calls; offline = false;
  await new Promise(resolve => setImmediate(resolve));
  evidence.networkRecovery = { listeners, pendingBeforeForeground: session.status().pending,
    extraCallsWithoutForeground: calls - callsBeforeRecovery };
  await session.onForeground();
  assert.equal(session.status().pending, 0);
  evidence.networkRecovery.pendingAfterForeground = 0;
  sync.onUnload(); offlineSync.onUnload();
  console.log(JSON.stringify(evidence, null, 2));
}
run().catch(error => { console.error(error); process.exitCode = 1; });
