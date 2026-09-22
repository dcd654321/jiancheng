const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { fixture, storageFixture, dates } = require('./helpers/cloud-fixture.cjs');
const { createCloudSession } = require('../miniprogram/services/cloud-session');
const { createWorkspaceStore } = require('../miniprogram/services/workspace-store');
const { createStore } = require('../miniprogram/services/store');
const tick = () => new Promise(resolve => setImmediate(resolve));

async function harness({ consent = true } = {}) {
  const f = fixture(); f.date = dates.today(); await f.seed();
  const wx = storageFixture(), calls = [], modals = [];
  wx.showModal = value => modals.push(value); wx.showToast = () => {};
  const h = { f, wx, calls, modals, offline: false, gate: null };
  const session = createCloudSession(wx, { enabled: true, envId: 'reliability-test' }, () => async event => {
    calls.push(event); if (h.gate) await h.gate;
    if (h.offline) throw Error('test offline'); return f.api(event);
  });
  const app = { cloudSession: session };
  app.store = createWorkspaceStore(createStore(wx), session);
  h.app = app; h.session = session;
  global.wx = wx; global.getApp = () => app;
  if (consent) await session.acceptConsent(true);
  h.page = (name, options = {}) => {
    let def; global.Page = value => { def = value; };
    const source = path.resolve(__dirname, '../miniprogram/pages/' + name + '/index.js');
    delete require.cache[source]; require(source);
    const p = { ...def, updates: 0, data: JSON.parse(JSON.stringify(def.data)),
      setData(patch) { this.updates++; Object.assign(this.data, patch); } };
    if (p.onLoad) p.onLoad(options); p.onShow(); return p;
  };
  return h;
}

test('first failed read is recovered by the actual sync-page retry without renewed consent', async t => {
  const h = await harness({ consent: false }); h.offline = true;
  await assert.rejects(h.session.acceptConsent(true));
  const p = h.page('sync'); t.after(() => p.onUnload());
  const before = h.calls.length; h.offline = false;
  await p.onRefresh(); await tick();
  assert.equal(h.calls.length, before + 1);
  assert.equal(p.data.ready, true); assert.equal(p.data.error, '');
});

test('note draft survives refresh, hide/show and reopening without being saved remotely', async t => {
  const h = await harness(); const p = h.page('detail', { id: 'read' });
  t.after(() => p.onUnload());
  p.onNote({ detail: { value: 'my unsaved note' } });
  p.refresh(); p.onHide(); p.onShow(); await tick();
  assert.equal(p.data.note, 'my unsaved note');
  assert.equal(p.data.noteDirty, true);
  p.onUnload();
  const again = h.page('detail', { id: 'read' }); t.after(() => again.onUnload());
  assert.equal(again.data.note, 'my unsaved note');
  assert.equal((await h.f.pull()).state.records['read@' + h.f.date], undefined);
});

test('failed local note save retains draft, successful queueing preserves newer typing', async t => {
  const h = await harness(); const p = h.page('detail', { id: 'read' }); t.after(() => p.onUnload());
  p.onNote({ detail: { value: 'first draft' } }); h.wx.failWrite = true;
  p.onSaveNote(); assert.equal(p.data.noteDirty, true); assert.equal(p.data.note, 'first draft');
  h.wx.failWrite = false; h.offline = true; p.onSaveNote();
  assert.equal(p.data.noteDirty, false);
  p.onNote({ detail: { value: 'second draft' } }); await tick();
  h.offline = false; await h.session.onForeground(); await tick();
  assert.equal(p.data.note, 'second draft'); assert.equal(p.data.noteDirty, true);
  assert.equal((await h.f.pull()).state.records['read@' + h.f.date].note, 'first draft');
});

test('session notifications update pending status and stop touching hidden/unloaded pages', async t => {
  const h = await harness(); const p = h.page('today'); t.after(() => p.onUnload());
  h.offline = true; h.session.dispatch({ type: 'complete', id: 'read', date: h.f.date }); await tick();
  assert.equal(p.data.syncAttention, true); assert.match(p.data.syncText, /待同步/);
  const sync = h.page('sync'); t.after(() => sync.onUnload());
  sync.onHide(); const updates = sync.updates;
  h.offline = false; await h.session.onForeground(); await tick();
  assert.equal(p.data.syncAttention, false); assert.equal(sync.updates, updates);
  p.onUnload(); const unloadedUpdates = p.updates;
  await h.session.refresh(); await tick(); assert.equal(p.updates, unloadedUpdates);
});

test('offline cached state never presents a current-cloud-saved heading', async t => {
  const h = await harness(); h.offline = true;
  await assert.rejects(h.session.refresh());
  const p = h.page('sync'); t.after(() => p.onUnload());
  assert.equal(p.data.ready, true); assert.equal(p.data.syncAttention, true);
  assert.match(p.data.syncText, /离线|未能/); assert.notEqual(p.data.syncText, '数据已同步');
  assert.doesNotMatch(p.data.lastSyncedLabel, /T\d{2}:.*Z/);
});

test('shared sync presentation prioritizes offline/conflict/errors over successful cache state', () => {
  const { syncPresentation, formatSyncTime } = require('../miniprogram/services/sync-presentation');
  assert.equal(syncPresentation({ ready: true, phase: 'ready' }).syncAttention, false);
  assert.equal(syncPresentation({ ready: true, phase: 'ready', lastError: 'failed' }).syncAttention, true);
  assert.match(syncPresentation({ ready: true, networkOffline: true, pending: 2 }).syncText, /2.*待同步/);
  assert.match(syncPresentation({ ready: true, busy: true, pending: 1 }).syncText, /同步/);
  assert.match(syncPresentation({ ready: true, conflict: { code: 'CONFLICT' } }).syncText, /冲突/);
  assert.equal(formatSyncTime('2026-09-20T06:32:14.930Z'), '2026-09-20 14:32（北京时间）');
  assert.equal(formatSyncTime('broken'), '');
  assert.equal(formatSyncTime('2026-02-30T06:32:14.930Z'), '');
});

test('recovery waits for an in-flight request and replays one durable operation id', async () => {
  const h = await harness(); h.offline = true;
  h.session.dispatch({ type: 'complete', id: 'read', date: h.f.date }); await tick();
  h.offline = false; let release; h.gate = new Promise(resolve => { release = resolve; });
  const refresh = h.session.refresh();
  const recovery = h.session.recoverConnection();
  release(); await Promise.all([refresh, recovery]);
  assert.equal(h.session.status().pending, 0);
  const ids = h.calls.filter(e => e.action === 'mutate').map(e => e.operationId);
  assert.equal(new Set(ids).size, 1);
});

test('network recovery is debounced, bounded, gated by visibility/consent and unregisters', async () => {
  const { createNetworkRecovery } = require('../miniprogram/services/network-recovery');
  let listener, registrations = 0, removed = 0, runs = 0, clock = 10000, consented = false;
  const timers = new Map(); let serial = 0;
  const wx = { onNetworkStatusChange(fn) { listener = fn; registrations++; },
    offNetworkStatusChange(fn) { assert.equal(fn, listener); removed++; } };
  const status = { configured: true, ready: true, pending: 1, conflict: null, phase: 'offline' };
  const session = { status: () => ({ ...status, consented }), setNetworkAvailable() {},
    async recoverConnection() { runs++; } };
  const r = createNetworkRecovery(wx, session, { now: () => clock,
    setTimer(fn, ms) { const id = ++serial; timers.set(id, {fn, ms}); return id; },
    clearTimer(id) { timers.delete(id); } });
  assert.equal(registrations, 1);
  const fire = async () => { const queued = [...timers.values()]; timers.clear(); for (const timer of queued) { clock += timer.ms; await timer.fn(); } await tick(); };
  r.onShow(); listener({ isConnected: true }); await fire(); assert.equal(runs, 0);
  consented = true;
  for (let i = 0; i < 30; i++) listener({ isConnected: true });
  assert.equal(timers.size, 1); await fire(); assert.equal(runs, 1);
  assert.equal(timers.size, 0, 'no background retry loop');
  listener({ isConnected: true }); assert.equal(timers.size, 1);
  assert.ok([...timers.values()][0].ms >= 1000);
  r.onHide(); await fire(); assert.equal(runs, 1);
  status.conflict = { code: 'CONFLICT' }; r.onShow(); listener({ isConnected: true }); await fire();
  assert.equal(runs, 1);
  r.dispose(); assert.equal(removed, 1); listener({ isConnected: true }); assert.equal(timers.size, 0);
});

test('a draft from a previous day remains visible but cannot become today\'s record', async t => {
  const h = await harness(); const p = h.page('detail', { id: 'read' }); t.after(() => p.onUnload());
  const old = dates.shift(h.f.date, -1);
  h.app.noteDrafts.set(h.app.store.contextKey(), 'read', old, 'yesterday draft');
  p.refresh();
  assert.equal(p.data.note, 'yesterday draft'); assert.equal(p.data.noteDate, old);
  assert.equal(p.data.noteExpired, true); assert.equal(p.onSaveNote(), false);
  assert.equal(h.session.status().pending, 0);
  assert.equal((await h.f.pull()).state.records['read@' + h.f.date], undefined);
});

test('drafts are memory-only, isolated by account generation, and clear only after acknowledged purge', async t => {
  const h = await harness(); const p = h.page('detail', { id: 'read' }); t.after(() => p.onUnload());
  p.onNote({ detail: { value: 'private unsubmitted text' } });
  const d = h.app.noteDrafts, before = h.app.store.contextKey();
  h.app.store = createWorkspaceStore(createStore(h.wx), h.session, d);
  h.offline = true; await assert.rejects(h.app.store.clear('DELETE_MY_DATA'));
  assert.equal(d.read(before, 'read').text, 'private unsubmitted text');
  h.offline = false; await h.app.store.clear('DELETE_MY_DATA');
  assert.notEqual(h.app.store.contextKey(), before); assert.equal(d.read(before, 'read'), null);
  const { createNoteDrafts } = require('../miniprogram/services/note-drafts');
  d.set('account-a', 'read', h.f.date, 'private');
  assert.equal(d.read('account-b', 'read'), null);
  assert.equal(d.read('account-a', 'read'), null);
  assert.equal(createNoteDrafts().read('account-a', 'read'), null);
});

test('daily record queued during a slow pull is eventually submitted; broken observers cannot block it', async () => {
  const h = await harness();
  const off = h.session.subscribe(() => { throw Error('broken view'); });
  let release; h.gate = new Promise(resolve => { release = resolve; });
  const refresh = h.session.refresh();
  h.session.dispatch({ type: 'complete', id: 'read', date: h.f.date });
  assert.equal(h.session.status().pending, 1);
  release(); await refresh; await tick(); off();
  assert.equal(h.session.status().pending, 0);
  assert.equal(h.calls.filter(e => e.action === 'mutate').length, 1);
});

test('connectivity changes do not claim success before recovery or erase a visible validation error', async t => {
  const h = await harness(); const p = h.page('today'); t.after(() => p.onUnload());
  p.setData({ error: '请检查输入' });
  h.session.setNetworkAvailable(false); await tick();
  assert.match(p.data.syncText, /离线/); assert.equal(p.data.error, '请检查输入');
  h.session.setNetworkAvailable(true); await tick();
  assert.equal(p.data.syncAttention, true);
  await h.session.recoverConnection(); await tick();
  assert.equal(p.data.syncAttention, false); assert.equal(p.data.error, '请检查输入');
});

test('cloud notifications preserve fields currently being edited', async t => {
  const h = await harness();
  h.wx.setNavigationBarTitle = () => {};
  const p = h.page('edit', { id: 'read' }); t.after(() => p.onUnload());
  p.onInput({ currentTarget: { dataset: { field: 'title' } }, detail: { value: 'not saved yet' } });
  await h.session.refresh(); await tick();
  assert.equal(p.data.title, 'not saved yet');
  assert.notEqual((await h.f.pull()).state.habits[0].versions[0].title, 'not saved yet');
});

test('a visible detail page stops exposing the previous account\'s note after a verified account switch', async t => {
  const h = await harness(); const p = h.page('detail', { id: 'read' }); t.after(() => p.onUnload());
  p.onNote({ detail: { value: 'account a draft' } });
  h.f.identity.OPENID = 'different-account';
  await h.session.start(); await tick();
  assert.equal(p.data.note, ''); assert.equal(p.data.noteDirty, false);
  assert.equal(p.data.dataReady, false); assert.equal(p.data.task, null);
  assert.equal(h.app.noteDrafts.read(h.app.store.contextKey(), 'read'), null);
});

test('repeated network events during an in-flight failure schedule one bounded follow-up, never a loop', async () => {
  const { createNetworkRecovery } = require('../miniprogram/services/network-recovery');
  let listener, runs = 0, release;
  const timers = new Map(); let serial = 0, clock = 1000;
  const gate = new Promise(resolve => { release = resolve; });
  const s = { status: () => ({ configured: true, consented: true }), setNetworkAvailable() {},
    async recoverConnection() { runs++; if (runs === 1) await gate; throw Error('offline'); } };
  const r = createNetworkRecovery({ onNetworkStatusChange(fn) { listener = fn; } }, s,
    { now: () => clock, setTimer(fn, ms) { const id = ++serial; timers.set(id, { fn, ms }); return id; }, clearTimer(id) { timers.delete(id); } });
  const fire = () => { const [id, timer] = [...timers.entries()][0]; timers.delete(id); clock += timer.ms; return timer.fn(); };
  r.onShow(); listener({ isConnected: true }); const first = fire();
  for (let i = 0; i < 20; i++) listener({ isConnected: true });
  assert.equal(timers.size, 0); release(); await first;
  assert.equal(timers.size, 1); await fire();
  assert.equal(runs, 2); assert.equal(timers.size, 0); r.dispose();
});
