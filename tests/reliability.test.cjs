const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { fixture, dates } = require('./helpers/cloud-fixture.cjs');
const { createCloudSession } = require('../miniprogram/services/cloud-session');
const { createWorkspaceStore } = require('../miniprogram/services/workspace-store');
const { createNoteDrafts } = require('../miniprogram/services/note-drafts');
const { createNetworkRecovery } = require('../miniprogram/services/network-recovery');
const { syncPresentation, formatSyncTime } = require('../miniprogram/services/sync-presentation');
const tick = () => new Promise(resolve => setImmediate(resolve));

async function harness() {
  const f = fixture(); f.date = dates.today(); await f.seed();
  const wx = { showToast() {}, showModal() {}, setNavigationBarTitle() {} };
  let offline = false;
  const session = createCloudSession(wx, { enabled: true, envId: 'reliability-test' }, () => event => offline ? Promise.reject(Error('offline')) : f.api(event));
  const noteDrafts = createNoteDrafts();
  const app = { cloudSession: session, noteDrafts, store: createWorkspaceStore(session, noteDrafts) };
  global.wx = wx; global.getApp = () => app;
  await session.start();
  const pages = [];
  function page(name, options = {}) {
    let definition; global.Page = value => { definition = value; };
    const source = path.resolve(__dirname, '../miniprogram/pages/' + name + '/index.js');
    delete require.cache[source]; require(source);
    const result = { ...definition, data: structuredClone(definition.data), setData(patch) { Object.assign(this.data, patch); } };
    pages.push(result); if (result.onLoad) result.onLoad(options); result.onShow(); return result;
  }
  return { f, wx, session, app, page, close() { pages.forEach(p => p.onUnload()); }, setOffline(value) { offline = value; } };
}

test('cloud status never says saved while offline or an operation is uncertain', () => {
  assert.equal(syncPresentation({ ready: true, phase: 'ready' }).syncText, '云端数据已确认');
  assert.match(syncPresentation({ ready: false, phase: 'offline', networkOffline: true }).syncText, /无法读取/);
  assert.match(syncPresentation({ ready: false, phase: 'uncertain', pending: 1 }).syncText, /待确认/);
  assert.match(syncPresentation({ deletionPending: true }).syncText, /删除/);
  assert.equal(formatSyncTime('2026-09-20T06:32:14.930Z'), '2026-09-20 14:32（北京时间）');
});

test('a failed refresh keeps confirmed content read-only until cloud is readable again', async t => {
  const h = await harness(); t.after(() => h.close());
  h.setOffline(true); await assert.rejects(h.session.refresh(), /offline/);
  const today = h.page('today');
  assert.equal(today.data.dataUnavailable, false, '本会话已确认内容保留展示，而不是清空成错误页');
  assert.equal(today.data.dataReady, true);
  assert.equal(today.data.dataReadOnly, true);
  assert.match(today.data.error, /暂时无法更新/);
  assert.equal(today.data.pending.length, 1);
  assert.throws(() => h.app.store.read(), error => error.code === 'DATA_UNAVAILABLE');
  h.setOffline(false); await h.session.refresh(); await tick();
  assert.equal(today.data.dataReady, true);
  assert.equal(today.data.dataReadOnly, false);
  assert.equal(today.data.dataUnavailable, false);
});

test('read-only fallback refuses writes with a reason and never queues an offline write', async t => {
  const h = await harness(); t.after(() => h.close());
  const today = h.page('today');
  h.setOffline(true); await assert.rejects(h.session.refresh(), /offline/);
  today.refresh();
  const result = today.onComplete({ currentTarget: { dataset: { id: 'read', date: h.f.date, done: false } } });
  assert.equal(result, false);
  assert.match(today.data.error, /暂时无法更新|联网/);
  assert.equal(today.data.done, 0);
  assert.equal(Object.keys((await h.f.pull()).state.records).length, 0, '断网时没有写入云端');
});

test('a note draft stays in RAM but failed save does not claim cloud persistence', async t => {
  const h = await harness(); t.after(() => h.close());
  const detail = h.page('detail', { id: 'read' });
  detail.onNote({ detail: { value: 'unsaved note' } });
  detail.refresh(); assert.equal(detail.data.noteDirty, true);
  h.setOffline(true); await detail.onSaveNote();
  assert.equal(detail.data.noteDirty, true);
  assert.equal((await h.f.pull()).state.records[`read@${h.f.date}`], undefined);
  assert.equal(h.app.noteDrafts.read(h.app.store.contextKey(), 'read').text, 'unsaved note');
});

test('cloud-confirmed note save clears only the matching in-memory draft', async t => {
  const h = await harness(); t.after(() => h.close());
  const detail = h.page('detail', { id: 'read' });
  detail.onNote({ detail: { value: 'first note' } });
  await detail.onSaveNote();
  assert.equal((await h.f.pull()).state.records[`read@${h.f.date}`].note, 'first note');
  assert.equal(h.app.noteDrafts.read(h.app.store.contextKey(), 'read'), null);
});

test('past-day draft cannot become today\'s cloud record', async t => {
  const h = await harness(); t.after(() => h.close());
  const detail = h.page('detail', { id: 'read' });
  h.app.noteDrafts.set(h.app.store.contextKey(), 'read', dates.shift(h.f.date, -1), 'old');
  detail.refresh();
  assert.equal(detail.data.noteExpired, true);
  assert.equal(detail.onSaveNote(), false);
  assert.equal((await h.f.pull()).state.records[`read@${h.f.date}`], undefined);
});

test('network recovery is bounded, visibility-gated, and unregisters', async () => {
  let listener, removed = 0, calls = 0;
  const timers = new Map(); let serial = 0;
  const session = { status: () => ({ configured: true }), setNetworkAvailable() {}, async recoverConnection() { calls++; } };
  const recovery = createNetworkRecovery({ onNetworkStatusChange(fn) { listener = fn; }, offNetworkStatusChange() { removed++; } }, session,
    { now: () => 10000, setTimer(fn) { const id = ++serial; timers.set(id, fn); return id; }, clearTimer(id) { timers.delete(id); } });
  listener({ isConnected: true }); assert.equal(timers.size, 0);
  recovery.onShow(); listener({ isConnected: true }); assert.equal(timers.size, 1);
  const work = [...timers.values()][0]; timers.clear(); await work();
  assert.equal(calls, 1); assert.equal(timers.size, 0);
  recovery.onHide(); listener({ isConnected: true }); assert.equal(timers.size, 0);
  recovery.dispose(); assert.equal(removed, 1);
});

test('verified account switch hides the prior account\'s visible draft', async t => {
  const h = await harness(); t.after(() => h.close());
  const detail = h.page('detail', { id: 'read' });
  detail.onNote({ detail: { value: 'account A private' } });
  h.f.identity.OPENID = 'different-account';
  await h.session.refresh(); await tick();
  assert.equal(detail.data.note, '');
  assert.equal(detail.data.invalid, true);
  assert.equal(h.app.noteDrafts.read(h.app.store.contextKey(), 'read'), null);
});
