const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { fixture, plan, dates } = require('./helpers/cloud-fixture.cjs');
const { createCloudSession } = require('../miniprogram/services/cloud-session');
const { createWorkspaceStore } = require('../miniprogram/services/workspace-store');

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function setup(route) {
  const f = fixture(); f.date = dates.today(); await f.seed();
  const calls = [], wx = {
    getStorageSync() { throw Error('device read forbidden'); },
    setStorageSync() { throw Error('device write forbidden'); },
    removeStorageSync() { throw Error('device delete forbidden'); }
  };
  const session = createCloudSession(wx, { enabled: true, envId: 'test-env' }, () => async event => {
    calls.push(event); return route ? route(event, f) : f.api(event);
  });
  const drafts = { cleared: 0, clear() { this.cleared++; } };
  const store = createWorkspaceStore(session, drafts);
  return { f, calls, wx, session, store, drafts };
}

test('workspace is unavailable until cloud read; no fake empty account or legacy storage', async () => {
  const h = await setup();
  assert.equal(h.store.info().source, 'cloud');
  assert.throws(() => h.store.read(), error => error.code === 'DATA_LOADING');
  await h.session.start();
  assert.equal(h.store.read().habits[0].id, 'read');
  assert.equal(h.store.exportCsv, undefined);
  assert.equal(h.store.rawBackup, undefined);
  assert.equal(h.store.legacyBackup, undefined);
});

test('create, edit and pause become visible only after direct cloud acknowledgements', async () => {
  const h = await setup(); await h.session.start();
  await h.store.dispatch({ type: 'create', id: 'new-cloud', startDate: h.f.date, plan: plan() });
  assert.equal(h.store.read().habits.length, 2);
  await h.store.dispatch({ type: 'edit', id: 'new-cloud', baseRevision: 1, plan: plan({ target: 8 }) });
  const habit = h.store.read().habits.find(item => item.id === 'new-cloud');
  assert.equal(habit.versions.at(-1).target, 8);
  await h.store.dispatch({ type: 'status', id: 'new-cloud', baseRevision: habit.revision, status: 'paused' });
  assert.equal((await h.f.pull()).state.habits.length, 2);
  assert.equal(h.session.status().pending, 0);
});

test('failed cloud write never appears saved; current session retries the same request', async () => {
  let lose = true;
  const h = await setup(async (event, f) => {
    const response = await f.api(event);
    if (event.action === 'mutate' && lose) { lose = false; throw Error('lost'); }
    return response;
  });
  await h.session.start();
  await assert.rejects(h.store.dispatch({ type: 'settings', hideQuote: true }), /未确认/);
  assert.throws(() => h.store.read(), error => error.code === 'DATA_UNAVAILABLE');
  await h.session.retry();
  assert.equal(h.store.read().settings.hideQuote, true);
  assert.deepEqual(h.calls.filter(call => call.action === 'mutate')[0], h.calls.filter(call => call.action === 'mutate')[1]);
});

test('native simplify string is normalized and stored in cloud', async () => {
  const h = await setup(); await h.session.start();
  await h.store.dispatch({ type: 'simplify', id: 'read', date: h.f.date, target: '2' });
  await h.store.dispatch({ type: 'complete', id: 'read', date: h.f.date });
  assert.equal(h.store.read().records[`read@${h.f.date}`].status, 'minimum');
  assert.equal(h.calls.find(call => call.command?.type === 'simplify').command.target, 2);
});

test('cloud-confirmed purge clears memory drafts; failed purge leaves them intact', async () => {
  const h = await setup(); await h.session.start();
  await assert.rejects(h.store.clear(''), /确认/);
  assert.equal(h.drafts.cleared, 0);
  await h.store.clear('DELETE_MY_DATA');
  assert.equal(h.drafts.cleared, 1);
  assert.equal(h.store.read().habits.length, 0);
});

test('account switch changes page context and reads only the new cloud account', async () => {
  const h = await setup(); await h.session.start();
  const oldContext = h.store.contextKey();
  h.f.identity.OPENID = 'second-user';
  await h.session.refresh();
  assert.notEqual(h.store.contextKey(), oldContext);
  assert.equal(h.store.read().habits.length, 0);
});

function page(h, name, options = {}) {
  const toasts = [], navigation = [];
  global.wx = { ...h.wx, showToast: value => toasts.push(value), showModal() {},
    navigateTo: value => navigation.push(value), navigateBack: () => navigation.push('back'),
    setNavigationBarTitle() {}, switchTab: value => navigation.push(value) };
  global.getApp = () => ({ store: h.store, cloudSession: h.session });
  let definition; global.Page = value => { definition = value; };
  const source = path.resolve(__dirname, '../miniprogram/pages/' + name + '/index.js');
  delete require.cache[source]; require(source);
  const result = { ...definition, data: structuredClone(definition.data), setData(patch) { Object.assign(this.data, patch); } };
  if (result.onLoad) result.onLoad(options);
  result.refresh();
  return { result, toasts, navigation };
}

test('today and progress show cloud-confirmed completion only after the request resolves', async () => {
  const gate = deferred(); let block = false;
  const h = await setup(async (event, f) => {
    if (block && event.action === 'mutate') await gate.promise;
    return f.api(event);
  });
  await h.session.start();
  const today = page(h, 'today'); block = true;
  const work = today.result.onComplete({ currentTarget: { dataset: { id: 'read', date: h.f.date, done: false } } });
  assert.equal(today.result.data.done, 0);
  assert.equal(today.toasts.length, 0);
  gate.resolve(); await work;
  assert.equal(today.result.data.done, 1);
  assert.match(today.toasts[0].title, /已保存到云端/);
  assert.equal(page(h, 'progress').result.data.stats.done, 1);
});

test('edit waits for confirmation and does not navigate on a lost write', async () => {
  let fail = false;
  const h = await setup((event, f) => fail ? Promise.reject(Error('offline')) : f.api(event));
  await h.session.start();
  const edit = page(h, 'edit', { template: 'study' });
  fail = true;
  await edit.result.onSave();
  assert.equal(edit.navigation.length, 0);
  assert.equal(edit.toasts.length, 0);
  assert.match(edit.result.data.error, /未确认/);
});
