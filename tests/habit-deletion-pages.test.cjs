const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fixture, dates, plan } = require('./helpers/cloud-fixture.cjs');
const { createCloudSession } = require('../miniprogram/services/cloud-session');
const { createWorkspaceStore } = require('../miniprogram/services/workspace-store');
const { createNoteDrafts } = require('../miniprogram/services/note-drafts');
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

async function setup(t, route) {
  const f = fixture(); f.date = dates.today(); await f.seed();
  const calls = [], modals = [], nav = [], toasts = [], drafts = createNoteDrafts();
  const stack = [{ route: 'pages/today/index' }, { route: 'pages/detail/index' }], backCalls = [];
  const wx = { showModal: value => modals.push(value), showToast: value => toasts.push(value),
    switchTab: value => { nav.push(value.url); value.success?.(); }, getSystemInfoSync: () => ({ fontSizeSetting: 16 }),
    redirectTo: value => { nav.push(value.url); value.success?.(); },
    navigateBack: value => { backCalls.push(value.delta); nav.push('/' + stack[stack.length - 1 - value.delta].route); value.success?.(); },
    setNavigationBarColor() {}, setBackgroundColor() {}, setTabBarStyle() {}, setTabBarItem() {},
    getStorageSync() { throw Error('device read forbidden'); }, setStorageSync() { throw Error('device write forbidden'); } };
  const session = createCloudSession(wx, { enabled: true, envId: 'test-env' }, () => async event => {
    calls.push(event); return route ? route(event, f) : f.api(event);
  });
  const store = createWorkspaceStore(session, drafts), app = { store, cloudSession: session, noteDrafts: drafts };
  await session.start();
  global.wx = wx; global.getApp = () => app; global.getCurrentPages = () => stack;
  let definition; global.Page = value => { definition = value; };
  const source = path.resolve(__dirname, '../miniprogram/pages/detail/index.js'); delete require.cache[source]; require(source);
  const page = { ...definition, data: structuredClone(definition.data), setData(value) { Object.assign(this.data, value); } };
  page.onLoad({ id: 'read' }); page.onShow(); t.after(() => page.onUnload());
  return { f, wx, calls, modals, nav, toasts, drafts, session, store, app, page, stack, backCalls };
}
function mutations(h) { return h.calls.filter(event => event.action === 'mutate'); }
function mountPage(t, name) {
  let definition; global.Page = value => { definition = value; };
  const source = path.resolve(__dirname, '../miniprogram/pages/' + name + '/index.js');
  delete require.cache[source]; require(source);
  const page = { ...definition, data: structuredClone(definition.data), setData(value, done) { Object.assign(this.data, value); done?.(); } };
  page.onShow(); t.after(() => page.onUnload()); return page;
}

test('delete entry is present and cancel keeps target and unsaved draft, with one modal at a time', async t => {
  const h = await setup(t), p = h.page;
  p.onNote({ detail: { value: 'draft' } }); p.onDeleteHabit(); p.onDeleteHabit();
  assert.equal(h.modals.length, 1); assert.equal(p.data.deleteConfirming, true);
  assert.match(h.modals[0].content, /读一会儿.*全部历史打卡.*无法恢复/);
  assert.match(h.modals[0].content, /未保存.*分享管理/);
  assert.equal(h.modals[0].confirmColor, '#A23C2E');
  await h.modals[0].success({ confirm: false });
  assert.equal(mutations(h).length, 0); assert.equal(p.data.deleteConfirming, false);
  assert.equal(h.store.read().habits.length, 1); assert.equal(p.data.noteDirty, true);
  const wxml = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/detail/index.wxml'), 'utf8');
  assert.match(wxml, /暂停、归档、删除/); assert.match(wxml, /bindtap="onDeleteHabit"/);
  assert.match(wxml, /dataReadOnly \|\| writeBusy \|\| pinning \|\| deleteConfirming/);
});

test('delete waits for acknowledgment, blocks repeats, cleans only its draft and returns to My Habits', async t => {
  const gate = deferred();
  const h = await setup(t, async (event, f) => { if (event.action === 'mutate') await gate.promise; return f.api(event); });
  const p = h.page, context = h.store.contextKey();
  p.onNote({ detail: { value: 'draft' } }); h.drafts.set(context, 'another', h.f.date, 'keep');
  p.onDeleteHabit(); const modal = h.modals[0], work = modal.success({ confirm: true });
  modal.success({ confirm: true }); p.onDeleteHabit();
  assert.equal(p.data.writeBusy, true); assert.equal(p.data.recordingLabel, '正在删除…');
  assert.equal(p.data.invalid, false); assert.equal(h.nav.length, 0); assert.equal(h.toasts.length, 0);
  assert.equal(h.drafts.read(context, 'read').text, 'draft'); assert.equal(mutations(h).length, 1);
  gate.resolve(); await work; await tick();
  assert.equal(h.store.read().habits.length, 0); assert.equal(h.drafts.read(context, 'read'), null);
  assert.equal(h.drafts.read(context, 'another').text, 'keep');
  assert.deepEqual(h.nav, ['/pages/manage/index']); assert.deepEqual(h.toasts.map(x => x.title), ['习惯已删除']);
  p.refresh(); assert.equal(p.data.invalid, true); assert.equal(p.data.writeBusy, false);
});

test('lost delete receipt keeps draft until original request retry confirms deletion and then navigates once', async t => {
  let lose = true;
  const h = await setup(t, async (event, f) => { const result = await f.api(event);
    if (event.action === 'mutate' && lose) { lose = false; throw Error('lost'); } return result; });
  const p = h.page, context = h.store.contextKey(); p.onNote({ detail: { value: 'draft' } });
  p.onDeleteHabit(); await h.modals[0].success({ confirm: true }); await tick();
  assert.equal(h.session.status().phase, 'uncertain'); assert.equal(h.nav.length, 0);
  assert.equal(h.drafts.read(context, 'read').text, 'draft'); assert.match(p.data.error, /未确认/);
  await p.onDataRetry(); await tick();
  assert.deepEqual(mutations(h)[0], mutations(h)[1]); assert.equal(h.drafts.read(context, 'read'), null);
  assert.deepEqual(h.nav, ['/pages/manage/index']); assert.equal(h.toasts.length, 1);
});

test('invalid receipts never signal confirmation and explicit rejection preserves habit and draft', async t => {
  const h = await setup(t, async (event, f) => {
    if (event.action !== 'mutate') return f.api(event);
    const result = await f.api(event); return { ...result, operationId: 'not-this-request' };
  });
  let confirmed = 0; h.session.subscribeConfirmed(() => confirmed++);
  h.page.onNote({ detail: { value: 'draft' } }); h.page.onDeleteHabit(); await h.modals.pop().success({ confirm: true });
  assert.equal(confirmed, 0); assert.equal(h.nav.length, 0); assert.equal(h.toasts.length, 0);
  assert.ok(h.drafts.read(h.store.contextKey(), 'read'));
  // A fresh readable account is used to exercise explicit rejection without discarding the pending event.
  const second = await setup(t, async (event, f) => event.action === 'mutate' ? { ok: false, code: 'INVALID_COMMAND', message: '未接受删除' } : f.api(event));
  second.page.onNote({ detail: { value: 'keep' } }); second.page.onDeleteHabit(); await second.modals[0].success({ confirm: true });
  assert.equal(second.store.read().habits.length, 1); assert.equal(second.nav.length, 0);
  assert.equal(second.drafts.read(second.store.contextKey(), 'read').text, 'keep'); assert.match(second.page.data.error, /未接受/);
});

test('offline, pinning and unavailable views cannot submit delete, modal failure releases the lock', async t => {
  const h = await setup(t), p = h.page;
  p._pinning = true; p.onDeleteHabit(); p._pinning = false;
  h.session.setNetworkAvailable(false); p.refresh(); p.onDeleteHabit();
  assert.equal(h.modals.length, 0); assert.equal(mutations(h).length, 0);
  h.session.setNetworkAvailable(true); await h.session.refresh(); p.refresh();
  p.onDeleteHabit(); h.modals[0].fail(); assert.equal(p.data.deleteConfirming, false);
  p.onDeleteHabit(); assert.equal(h.modals.length, 2);
});

test('old delete confirmations cannot apply after date, state, account or page visit changes', async t => {
  for (const change of ['date', 'state', 'account', 'hide', 'reenter', 'unload']) {
    const h = await setup(t), p = h.page; p.onDeleteHabit(); const modal = h.modals[0];
    const originalToday = dates.today;
    try {
      if (change === 'date') dates.today = () => dates.shift(h.f.date, 1);
      if (change === 'state') { await h.f.mutate({ type: 'settings', hideQuote: true }); await h.session.refresh(); }
      if (change === 'account') { h.f.identity.OPENID = 'test_other'; await h.session.refresh(); }
      if (change === 'hide' || change === 'reenter') { p.onHide(); if (change === 'reenter') p.onShow(); }
      if (change === 'unload') p.onUnload();
      await modal.success({ confirm: true }); assert.equal(mutations(h).length, 0, change); assert.equal(h.nav.length, 0, change);
    } finally { dates.today = originalToday; }
  }
});

test('late delete receipt cannot navigate a new visit', async t => {
  const gate = deferred();
  const h = await setup(t, async (event, f) => { const result = await f.api(event); if (event.action === 'mutate') await gate.promise; return result; });
  const p = h.page; p.onNote({ detail: { value: 'old' } }); p.onDeleteHabit(); const work = h.modals[0].success({ confirm: true });
  await tick(); p.onHide(); p.onShow();
  gate.resolve(); await work; await tick();
  assert.equal(h.nav.length, 0); assert.equal(h.toasts.length, 0);
});

test('old account deletion receipt cannot remove the new account same-id draft or navigate', async t => {
  const gate = deferred();
  const h = await setup(t, async (event, f) => { const result = await f.api(event); if (event.action === 'mutate') await gate.promise; return result; });
  const p = h.page; p.onNote({ detail: { value: 'old' } }); p.onDeleteHabit(); const work = h.modals[0].success({ confirm: true });
  await tick(); p.onHide();
  const f = fixture(); f.date = h.f.date; f.identity.OPENID = 'new-account'; await f.seed();
  const session = createCloudSession(h.wx, { enabled: true, envId: 'test-env' }, () => event => f.api(event));
  await session.start(); const store = createWorkspaceStore(session, h.drafts);
  h.app.cloudSession = session; h.app.store = store;
  h.drafts.set(store.contextKey(), 'read', f.date, 'new'); p.onShow();
  gate.resolve(); await work; await tick();
  assert.equal(h.nav.length, 0); assert.equal(h.toasts.length, 0);
  assert.equal(h.drafts.read(store.contextKey(), 'read').text, 'new'); assert.equal(p.data.note, 'new');
});

test('successful deletion has a recoverable My Habits exit when navigation fails', async t => {
  const h = await setup(t); h.wx.redirectTo = value => value.fail();
  h.page.onDeleteHabit(); await h.modals[0].success({ confirm: true }); await tick();
  assert.equal(h.page.data.invalid, true); assert.match(h.page.data.error, /习惯已删除.*返回我的习惯/);
  assert.equal(h.toasts.length, 0);
  h.wx.redirectTo = value => { h.nav.push(value.url); value.success?.(); };
  h.page.onManage(); assert.deepEqual(h.nav, ['/pages/manage/index']);
});

test('deletion updates Today, progress and management from the confirmed account, including last-habit empty state', async t => {
  for (const keepAnother of [true, false]) {
    const h = await setup(t);
    await h.store.dispatch({ type: 'complete', id: 'read', date: h.f.date });
    if (keepAnother) await h.store.dispatch({ type: 'create', id: 'another', startDate: h.f.date, plan: plan() });
    const today = mountPage(t, 'today'), progress = mountPage(t, 'progress'), manage = mountPage(t, 'manage');
    assert.equal(today.data.done, 1); assert.equal(progress.data.stats.done, 1);
    h.page.refresh(); h.page.onDeleteHabit(); await h.modals[0].success({ confirm: true });
    assert.equal(today.data.total, keepAnother ? 1 : 0); assert.equal(today.data.done, 0);
    assert.equal(today.data.hasHabits, keepAnother); assert.deepEqual(today.data.completed, []);
    assert.deepEqual(today.data.pending.map(row => row.id), keepAnother ? ['another'] : []);
    assert.equal(progress.data.stats.done, 0);
    assert.ok(progress.data.stats.cells.every(cell => cell.tasks.every(task => task.id !== 'read')));
    assert.deepEqual(manage.data.habits.map(row => row.id), keepAnother ? ['another'] : []);
  }
});

test('delete remains available for paused, archived and future-only habits', async t => {
  for (const status of ['paused', 'archived', 'future']) {
    const h = await setup(t);
    if (status === 'future') {
      await h.store.dispatch({ type: 'deleteHabit', id: 'read', baseRevision: 1 });
      await h.store.dispatch({ type: 'create', id: 'read', startDate: dates.shift(h.f.date, 1), plan: plan() });
    } else {
      await h.store.dispatch({ type: 'status', id: 'read', status, baseRevision: 1 });
      h.f.date = dates.shift(h.f.date, 1);
    }
    const originalToday = dates.today;
    try {
      dates.today = () => h.f.date; h.page.refresh(); h.page.onDeleteHabit();
      assert.equal(h.modals.length, 1, status);
      await h.modals[0].success({ confirm: true });
      assert.deepEqual(h.store.read().habits, [], status); assert.deepEqual(h.nav, ['/pages/manage/index'], status);
    } finally { dates.today = originalToday; }
  }
});

test('deletion returns to the existing My Habits page instead of creating a duplicate', async t => {
  const h = await setup(t);
  h.stack.splice(0, h.stack.length, { route: 'pages/mine/index' }, { route: 'pages/manage/index' }, { route: 'pages/detail/index' });
  const manage = mountPage(t, 'manage'); assert.equal(manage.data.habits.length, 1);
  h.page.onDeleteHabit(); await h.modals[0].success({ confirm: true });
  assert.deepEqual(h.backCalls, [1]); assert.deepEqual(h.nav, ['/pages/manage/index']);
  assert.deepEqual(manage.data.habits, []);
});

test('failed return to an existing management page falls back to replacing detail', async t => {
  const h = await setup(t);
  h.stack.splice(0, h.stack.length, { route: 'pages/manage/index' }, { route: 'pages/detail/index' });
  h.wx.navigateBack = value => { h.backCalls.push(value.delta); value.fail(); };
  h.page.onDeleteHabit(); await h.modals[0].success({ confirm: true });
  assert.deepEqual(h.backCalls, [1]); assert.deepEqual(h.nav, ['/pages/manage/index']); assert.equal(h.toasts.length, 1);
});

test('old cloud service rejection is explicit and cannot remove data or navigate', async t => {
  const h = await setup(t, (event, f) => event.action === 'mutate' ? { ok: false, code: 'INVALID_REQUEST', message: '不支持的操作' } : f.api(event));
  h.page.onNote({ detail: { value: 'keep' } }); h.page.onDeleteHabit(); await h.modals[0].success({ confirm: true });
  assert.equal(h.store.read().habits.length, 1); assert.equal(h.drafts.read(h.store.contextKey(), 'read').text, 'keep');
  assert.match(h.page.data.error, /删除功能暂不可用/); assert.deepEqual(h.nav, []); assert.deepEqual(h.toasts, []);
  assert.equal(h.session.status().pending, 0);
});
