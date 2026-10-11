const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { fixture, domain, dates, plan } = require('./helpers/cloud-fixture.cjs');
const { createCloudSession } = require('../miniprogram/services/cloud-session');
const { createWorkspaceStore } = require('../miniprogram/services/workspace-store');
const event = dataset => ({ currentTarget: { dataset } });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

async function setup(t, prepare, route) {
  const f = fixture(); f.date = dates.today(); if (prepare) await prepare(f); else await f.seed();
  const toasts = [], modals = [], navigation = [], pages = [], calls = [];
  const wx = { showToast: value => toasts.push(value), showModal: value => modals.push(value), navigateTo: value => navigation.push(value.url), getSystemInfoSync: () => ({ fontSizeSetting: 16 }) };
  const session = createCloudSession(wx, { enabled: true, envId: 'test-cloud' }, () => async command => {
    calls.push(command); return route ? route(command, f) : f.api(command);
  });
  const store = createWorkspaceStore(session), app = { cloudSession: session, store, featuresClient: { status: () => ({ enabled: false }), cachedPreferences: () => null } };
  global.wx = wx; global.getApp = () => app;
  app.dataReady = session.start(); await app.dataReady;
  t.after(() => pages.forEach(page => page.onUnload()));
  async function page(name, options = {}) {
    let definition; global.Page = value => { definition = value; };
    const file = path.resolve(__dirname, '../miniprogram/pages/' + name + '/index.js'); delete require.cache[file]; require(file);
    const page = { ...definition, data: structuredClone(definition.data), refreshes: 0,
      setData(value) { Object.assign(this.data, value); }, refresh() { this.refreshes++; return definition.refresh.call(this); } };
    pages.push(page); if (page.onLoad) page.onLoad(options); await page.onShow(); page.refreshes = 0; return page;
  }
  return { f, session, store, app, calls, toasts, modals, navigation, page };
}

test('detail only projects today records while check-in and undo stay available on today', async t => {
  const h = await setup(t), detail = await h.page('detail', { id: 'read' }), today = await h.page('today');
  for (const action of ['onComplete', 'onCompleteMinimum', 'recordCompletion', 'onSimplify', 'onRestore']) {
    assert.equal(detail[action], undefined, `${action} must not be exposed by detail`);
    assert.equal(typeof today[action], 'function', `${action} remains available on today`);
  }
  assert.equal(detail.data.task.done, false);
  assert.equal(detail.onCancelFuture, undefined);
  await today.onComplete(event({ id: 'read', date: h.f.date, done: false }));
  assert.equal(detail.data.task.done, true); assert.equal(today.data.done, 1);
  await today.onComplete(event({ id: 'read', date: h.f.date, done: true }));
  assert.equal(detail.data.task.done, false); assert.equal(today.data.done, 0);
});

test('latest habit status updates detail management and progress only after confirmation while today and history stay fixed', async t => {
  const gate = deferred(), h = await setup(t, null, async (command, f) => {
    if (command.action === 'mutate') await gate.promise;
    return f.api(command);
  });
  const detail = await h.page('detail', { id: 'read' }), manage = await h.page('manage'), progress = await h.page('progress');
  const todayTask = domain.taskAt(h.store.read(), h.store.read().habits[0], h.f.date);
  const records = structuredClone(h.store.read().records), history = structuredClone(detail.data.history);
  function statusEverywhere(expected) {
    assert.equal(detail.data.statusText, expected);
    assert.equal(manage.data.habits[0].status, expected);
    assert.equal(progress.data.stats.habits[0].statusLabel, expected);
    assert.deepEqual(detail.data.task, todayTask);
    assert.deepEqual(detail.data.history, history); assert.deepEqual(h.store.read().records, records);
  }
  statusEverywhere('进行中');
  detail.onStatus(event({ status: 'paused' })); const pending = h.modals.pop().success({ confirm: true });
  statusEverywhere('进行中'); gate.resolve(); await pending; statusEverywhere('已暂停');
  assert.equal(detail.data.current.status, 'active'); assert.equal(detail.data.future.status, 'paused');
  await detail.onResume(); statusEverywhere('进行中');
  detail.onStatus(event({ status: 'archived' })); await h.modals.pop().success({ confirm: true }); statusEverywhere('已归档');
  await detail.onUnarchive(); statusEverywhere('进行中');
});

test('resume from a paused latest plan on an archived day restores active and preserves tomorrow edits', async t => {
  const h = await setup(t, async f => {
    const today = f.date; f.date = dates.shift(today, -1); await f.seed();
    await f.mutate({ type: 'status', id: 'read', baseRevision: 1, status: 'archived' }); f.date = today;
  });
  const p = await h.page('detail', { id: 'read' });
  p.onUnarchive(); await h.modals.pop().success({ confirm: true });
  await h.store.dispatch({ type: 'edit', id: 'read', baseRevision: h.store.read().habits[0].revision, plan: plan({ target: 8, minimum: 3 }) });
  p.onStatus(event({ status: 'paused' })); await h.modals.pop().success({ confirm: true });
  assert.equal(p.data.statusText, '已暂停'); assert.equal(p.data.current.status, 'archived');
  p.onResume(); await h.modals.pop().success({ confirm: true });
  assert.equal(p.data.statusText, '进行中'); assert.equal(p.data.current.status, 'archived');
  assert.equal(p.data.future.status, 'active'); assert.equal(p.data.future.target, 8); assert.equal(p.data.task, null);
  assert.equal(domain.tasksOn(h.store.read(), dates.shift(h.f.date, 1))[0].target, 8);
});

test('resume works for pending and effective pauses without changing today or history', async t => {
  const h = await setup(t), p = await h.page('detail', { id: 'read' }), today = h.f.date;
  await h.store.dispatch({ type: 'complete', id: 'read', date: today }); const record = structuredClone(h.store.read().records);
  p.onStatus(event({ status: 'paused' })); await h.modals.pop().success({ confirm: true });
  assert.equal(p.data.statusText, '已暂停'); assert.equal(p.data.plannedStatus, 'paused'); assert.ok(p.data.task);
  await p.onResume(); assert.equal(p.data.statusText, '进行中'); assert.equal(p.data.future, null); assert.equal(p.data.plannedStatus, 'active');
  assert.deepEqual(h.store.read().records, record);
  p.onStatus(event({ status: 'paused' })); await h.modals.pop().success({ confirm: true });
  const actualToday = dates.today; dates.today = () => dates.shift(today, 1); t.after(() => { dates.today = actualToday; });
  h.f.date = dates.today(); await h.session.refresh();
  assert.equal(p.data.current.status, 'paused'); assert.equal(p.data.statusText, '已暂停'); assert.equal(p.data.task, null);
  p.onResume(); await h.modals.pop().success({ confirm: true });
  assert.equal(p.data.current.status, 'paused'); assert.equal(p.data.future.status, 'active'); assert.equal(p.data.plannedStatus, 'active');
  assert.equal(domain.tasksOn(h.store.read(), dates.shift(h.f.date, 1)).length, 1); assert.deepEqual(h.store.read().records, record);
});

test('capacity refusal preserves the paused plan and a previous date confirmation cannot resume it', async t => {
  const h = await setup(t, async f => {
    const today = f.date; f.date = dates.shift(today, -1); await f.seed();
    await f.mutate({ type: 'status', id: 'read', baseRevision: 1, status: 'paused' }); f.date = today;
    for (let i = 0; i < 5; i++) await f.mutate({ type: 'create', id: 'other' + i, startDate: today, plan: plan() });
  });
  const p = await h.page('detail', { id: 'read' }), before = h.store.read();
  p.onResume(); await h.modals.pop().success({ confirm: true });
  assert.match(p.data.error, /最多同时进行5个/); assert.deepEqual(h.store.read(), before); assert.equal(h.toasts.length, 0);
  p.onResume(); const confirmation = h.modals.pop();
  const actualToday = dates.today; dates.today = () => dates.shift(h.f.date, 1);
  try { await confirmation.success({ confirm: true }); assert.match(p.data.error, /日期已变化/); assert.deepEqual(h.store.read(), before); }
  finally { dates.today = actualToday; }
});

test('resuming a pending pause preserves prior target changes scheduled for tomorrow', async t => {
  const h = await setup(t), p = await h.page('detail', { id: 'read' });
  await h.store.dispatch({ type: 'edit', id: 'read', baseRevision: 1, plan: plan({ target: 8, minimum: 3 }) });
  p.onStatus(event({ status: 'paused' })); await h.modals.pop().success({ confirm: true });
  assert.equal(p.data.statusText, '已暂停'); await p.onResume();
  assert.equal(p.data.statusText, '进行中'); assert.equal(p.data.current.target, 5);
  assert.equal(p.data.future.status, 'active'); assert.equal(p.data.future.target, 8); assert.equal(p.data.future.minimum, 3);
  assert.equal(domain.tasksOn(h.store.read(), dates.shift(h.f.date, 1))[0].target, 8);
});

test('pending archive can be cancelled without changing today or saved records', async t => {
  const h = await setup(t), p = await h.page('detail', { id: 'read' });
  await h.store.dispatch({ type: 'complete', id: 'read', date: h.f.date });
  await h.store.dispatch({ type: 'note', id: 'read', date: h.f.date, note: '今天走过一段路' });
  const records = structuredClone(h.store.read().records);
  p.onStatus(event({ status: 'archived' })); await h.modals.pop().success({ confirm: true });
  assert.equal(p.data.statusText, '已归档'); assert.equal(p.data.plannedStatus, 'archived'); assert.equal(p.data.task.done, true);
  assert.equal(await p.onUnarchive(), true);
  assert.equal(p.data.statusText, '进行中'); assert.equal(p.data.future, null); assert.equal(p.data.plannedStatus, 'active');
  assert.equal(p.data.task.done, true); assert.deepEqual(h.store.read().records, records);
  assert.equal(domain.tasksOn(h.store.read(), dates.shift(h.f.date, 1)).length, 1);
});

test('cancelling archive keeps tomorrow edits and restores the current status', async t => {
  const h = await setup(t), p = await h.page('detail', { id: 'read' });
  await h.store.dispatch({ type: 'edit', id: 'read', baseRevision: 1,
    plan: plan({ title: '读更久一点', target: 8, minimum: 3, time: '20:30' }) });
  p.onStatus(event({ status: 'archived' })); await h.modals.pop().success({ confirm: true });
  assert.equal(p.data.statusText, '已归档'); assert.equal(await p.onUnarchive(), true);
  assert.equal(p.data.statusText, '进行中'); assert.equal(p.data.current.target, 5);
  assert.equal(p.data.future.status, 'active'); assert.equal(p.data.future.title, '读更久一点');
  assert.equal(p.data.future.target, 8); assert.equal(p.data.future.minimum, 3); assert.equal(p.data.future.time, '20:30');
  const tomorrow = domain.tasksOn(h.store.read(), dates.shift(h.f.date, 1))[0];
  assert.equal(tomorrow.title, '读更久一点'); assert.equal(tomorrow.target, 8); assert.equal(tomorrow.minimum, 3);
});

test('cancelling pending archive of a paused habit returns to paused and preserves its history', async t => {
  const h = await setup(t, async f => {
    const today = f.date; f.date = dates.shift(today, -1); await f.seed();
    await f.mutate({ type: 'complete', id: 'read', date: f.date });
    await f.mutate({ type: 'status', id: 'read', baseRevision: 1, status: 'paused' }); f.date = today;
  });
  const p = await h.page('detail', { id: 'read' }), records = structuredClone(h.store.read().records);
  assert.equal(p.data.current.status, 'paused'); assert.equal(p.data.task, null);
  p.onStatus(event({ status: 'archived' })); await h.modals.pop().success({ confirm: true });
  assert.equal(p.data.statusText, '已归档'); assert.equal(await p.onUnarchive(), true);
  assert.equal(p.data.current.status, 'paused'); assert.equal(p.data.future, null); assert.equal(p.data.plannedStatus, 'paused');
  assert.equal(domain.tasksOn(h.store.read(), dates.shift(h.f.date, 1)).length, 0);
  assert.deepEqual(h.store.read().records, records);
});

test('an archived habit can resume tomorrow without changing its archived day or earlier records', async t => {
  const h = await setup(t, async f => {
    const today = f.date; f.date = dates.shift(today, -1); await f.seed();
    await f.mutate({ type: 'complete', id: 'read', date: f.date });
    await f.mutate({ type: 'status', id: 'read', baseRevision: 1, status: 'archived' }); f.date = today;
  });
  const p = await h.page('detail', { id: 'read' }), records = structuredClone(h.store.read().records);
  assert.equal(p.data.current.status, 'archived'); assert.equal(p.data.statusText, '已归档'); assert.equal(p.data.task, null);
  p.onUnarchive(); const confirmation = h.modals.pop(); assert.match(confirmation.title, /取消归档/); await confirmation.success({ confirm: true });
  assert.equal(p.data.current.status, 'archived'); assert.equal(p.data.future.status, 'active'); assert.equal(p.data.task, null);
  assert.equal(domain.tasksOn(h.store.read(), dates.shift(h.f.date, 1)).length, 1);
  assert.deepEqual(h.store.read().records, records);
});

test('archive cancellation rejects stale dates, changed contexts and hidden views before writing', async t => {
  const h = await setup(t, async f => { await f.seed(); await f.mutate({ type: 'status', id: 'read', baseRevision: 1, status: 'archived' }); });
  const p = await h.page('detail', { id: 'read' }), before = h.store.read(), requests = h.calls.length;
  const actualToday = dates.today; dates.today = () => dates.shift(h.f.date, 1);
  try { assert.equal(await p.onUnarchive(), false); }
  finally { dates.today = actualToday; }
  assert.deepEqual(h.store.read(), before); assert.equal(h.calls.length, requests);
  const originalContext = h.store.contextKey; h.store.contextKey = () => originalContext() + ':changed';
  try { assert.equal(await p.onUnarchive(), false); }
  finally { h.store.contextKey = originalContext; }
  assert.deepEqual(h.store.read(), before); assert.equal(h.calls.length, requests);
  p.onHide(); assert.equal(await p.onUnarchive(), false);
  assert.deepEqual(h.store.read(), before); assert.equal(h.calls.length, requests); assert.equal(h.toasts.length, 0);
});

test('archive cancellation uses the shared mutation lock to send a single request', async t => {
  const gate = deferred(), h = await setup(t,
    async f => { await f.seed(); await f.mutate({ type: 'status', id: 'read', baseRevision: 1, status: 'archived' }); },
    async (command, f) => { if (command.action === 'mutate') await gate.promise; return f.api(command); });
  const p = await h.page('detail', { id: 'read' }), requests = h.calls.length;
  const first = p.onUnarchive();
  assert.equal(p.data.writeBusy, true); assert.equal(await p.onUnarchive(), false);
  assert.equal(h.calls.length, requests + 1); assert.equal(p.data.statusText, '已归档');
  gate.resolve(); assert.equal(await first, true);
  assert.equal(p.data.writeBusy, false); assert.equal(p.data.statusText, '进行中'); assert.equal(p.data.future, null);
  assert.equal(h.calls.length, requests + 1); assert.equal(h.toasts.length, 1);
});

test('check-in and undo project their own visible page once, use one request and keep other pages updated', async t => {
  const h = await setup(t), p = await h.page('today'), progress = await h.page('progress');
  let reads = 0; const read = h.store.read; h.store.read = () => { reads++; return read(); };
  for (const done of [false, true]) {
    p.refreshes = 0; progress.refreshes = 0; reads = 0; const requests = h.calls.length, toasts = h.toasts.length;
    await p.onComplete(event({ id: 'read', date: h.f.date, done }));
    assert.equal(p.refreshes, 1); assert.equal(h.calls.length, requests + 1); assert.equal(h.calls.at(-1).action, 'mutate');
    assert.equal(h.toasts.length, toasts + 1); assert.equal(p.data.done, done ? 0 : 1); assert.equal(progress.data.stats.done, done ? 0 : 1);
    assert.equal(reads, p.refreshes + progress.refreshes, 'only data projections read the full state, with no first-completion scan');
  }
});

test('a conflicting check-in refreshes trusted remote facts while reporting rejection and no success', async t => {
  const h = await setup(t), p = await h.page('today');
  await h.f.mutate({ type: 'complete', id: 'read', date: h.f.date });
  assert.equal(await p.onComplete(event({ id: 'read', date: h.f.date })), false);
  assert.equal(p.refreshes, 1); assert.equal(p.data.done, 1); assert.match(p.data.error, /另一设备/); assert.equal(h.toasts.length, 0);
  assert.equal(p.data.writeBusy, false); assert.equal(h.session.status().pending, 0);
});

test('a new page visit receives a late check-in snapshot without the old success toast', async t => {
  const gate = deferred(), h = await setup(t, null, async (command, f) => { if (command.action === 'mutate') await gate.promise; return f.api(command); });
  const p = await h.page('today'), work = p.onComplete(event({ id: 'read', date: h.f.date }));
  p.onHide(); await p.onShow(); gate.resolve(); await work;
  assert.equal(p.data.done, 1); assert.equal(p.data.showCompleted, false); assert.equal(h.toasts.length, 0); assert.equal(p.data.writeBusy, false);
});
