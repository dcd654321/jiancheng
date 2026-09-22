const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { fixture, storageFixture, plan, dates } = require('./helpers/cloud-fixture.cjs');
const { createStore, STORAGE_KEY } = require('../miniprogram/services/store');
const { createCloudSession } = require('../miniprogram/services/cloud-session');
const { createWorkspaceStore } = require('../miniprogram/services/workspace-store');

const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

async function setup(override, { consent = true } = {}) {
  const f = fixture();
  f.date = dates.today();
  await f.seed();
  const wx = storageFixture();
  const calls = [];
  const session = createCloudSession(wx, { enabled: true, envId: 'test-env' }, () => async event => {
    calls.push(event);
    return override ? override(event, f) : f.api(event);
  });
  const local = createStore(wx);
  const store = createWorkspaceStore(local, session);
  local.dispatch({ type: 'create', id: 'local-only', startDate: f.date,
    plan: plan({ title: '仅在本机' }) });
  if (consent) await session.acceptConsent(true);
  return { f, wx, calls, session, local, store };
}

const rec = (f, type = 'complete', extra = {}) => ({ type, id: 'read', date: f.date, ...extra });

test('workspace never reads or writes legacy habits as active data', async () => {
  const h = await setup();
  const legacyRaw = h.wx.getStorageSync(STORAGE_KEY);
  assert.equal(h.store.info().source, 'cloud');
  assert.equal(h.store.read().habits[0].id, 'read');
  h.store.dispatch(rec(h.f));
  assert.equal(h.session.status().pending, 1);
  assert.equal(h.wx.getStorageSync(STORAGE_KEY), legacyRaw);
  assert.equal(h.store.hasLegacyData(), true);
  assert.equal(typeof h.store.legacyBackup(), 'string');
  assert.equal(h.store.useLocal, undefined);
  assert.equal(h.store.useCloud, undefined);
});

test('workspace clears legacy data only after cloud purge acknowledgement', async () => {
  const h = await setup();
  await assert.rejects(h.store.clear(''), /确认/);
  assert.equal(h.local.read().habits.length, 1);
  const result = await h.store.clear('DELETE_MY_DATA');
  assert.equal(result.state.habits.length, 0);
  assert.equal(h.store.read().habits.length, 0);
  assert.equal(h.local.read().habits.length, 0);
});

test('workspace exposes consent, loading and unavailable states without a fake empty state', () => {
  const legacy = { read() { throw Error('must not read legacy'); }, rawBackup() { return '{}'; } };
  const needsConsent = createWorkspaceStore(legacy, { status: () => ({ ready: false, phase: 'needsConsent' }) });
  assert.throws(() => needsConsent.read(), error => error.code === 'NEEDS_CONSENT');
  const loading = createWorkspaceStore(legacy, { status: () => ({ ready: false, phase: 'loading', lastError: '' }) });
  assert.throws(() => loading.read(), error => error.code === 'DATA_LOADING');
  const unavailable = createWorkspaceStore(legacy, { status: () => ({ ready: false, phase: 'loading', lastError: 'offline' }) });
  assert.throws(() => unavailable.read(), error => error.code === 'DATA_UNAVAILABLE');
});

test('account binding changes the context and never falls back to legacy records', async () => {
  const h = await setup();
  const before = h.store.contextKey();
  h.f.identity.OPENID = 'another-user';
  await h.session.start();
  assert.notEqual(h.store.contextKey(), before);
  assert.equal(h.store.read().habits.length, 0);
  assert.equal(h.local.read().habits[0].id, 'local-only');
});

test('create, edit and pause are confirmed online while legacy records remain untouched', async () => {
  const h = await setup();
  await h.store.dispatch({ type: 'create', id: 'new-cloud', startDate: h.f.date, plan: plan() });
  assert.equal(h.store.read().habits.length, 2);
  assert.equal(h.session.status().pending, 0);
  await h.store.dispatch({ type: 'edit', id: 'new-cloud', baseRevision: 1, plan: plan({ target: 8 }) });
  const habit = h.store.read().habits.find(item => item.id === 'new-cloud');
  assert.equal(habit.versions[1].target, 8);
  await h.store.dispatch({ type: 'status', id: 'new-cloud', baseRevision: habit.revision, status: 'paused' });
  assert.equal(h.local.read().habits.length, 1);
  assert.equal((await h.f.pull()).state.habits.length, 2);
});

test('offline management is not queued and pending daily records block plan changes', async () => {
  let offline = false;
  const h = await setup((event, f) => {
    if (offline) throw Error('offline');
    return f.api(event);
  });
  offline = true;
  await assert.rejects(h.store.dispatch({ type: 'settings', hideQuote: true }), /offline/);
  assert.equal(h.session.status().pending, 0);
  h.store.dispatch(rec(h.f));
  // Let the independent daily-record flush settle before counting management requests.
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.session.status().pending, 1);
  const requests = h.calls.length;
  await assert.rejects(h.store.dispatch({ type: 'settings', hideQuote: true }), /待同步/);
  assert.equal(h.calls.length, requests);
});

test('lost management response preserves the operation id and retry writes once', async () => {
  let lose = true;
  const h = await setup(async (event, f) => {
    const result = await f.api(event);
    if (event.action === 'mutate' && lose) {
      lose = false;
      throw Error('lost');
    }
    return result;
  });
  await assert.rejects(h.store.dispatch({ type: 'settings', hideQuote: true }), /尚未确认/);
  const revision = (await h.f.pull()).revision;
  assert.equal(h.session.status().pending, 1);
  assert.throws(() => h.store.dispatch(rec(h.f)), /待同步/);
  await h.session.retry();
  assert.equal((await h.f.pull()).revision, revision);
  assert.equal(h.session.status().pending, 0);
});

test('unfinished management request crossing a date requires confirmation again', async () => {
  let rejectWrite = true;
  const h = await setup(async (event, f) => {
    if (event.action === 'mutate' && rejectWrite) throw Error('offline');
    return f.api(event);
  });
  await assert.rejects(h.store.dispatch({ type: 'edit', id: 'read', baseRevision: 1,
    plan: plan({ target: 8 }) }));
  rejectWrite = false;
  h.f.date = dates.shift(h.f.date, 1);
  await h.session.retry();
  assert.equal(h.session.status().conflict.code, 'RECONFIRM_REQUIRED');
  assert.equal((await h.f.pull()).state.habits[0].versions.length, 1);
});

test('native string simplify input is normalized before server submission', async () => {
  const h = await setup();
  h.store.dispatch(rec(h.f, 'simplify', { target: '2' }));
  h.store.dispatch(rec(h.f));
  await h.session.retry();
  assert.equal(h.session.status().pending, 0);
  assert.equal((await h.f.pull()).state.records['read@' + h.f.date].status, 'minimum');
});

test('cache write failure never displays a completed record and cloud clear is exposed', async () => {
  const h = await setup();
  h.wx.failWrite = true;
  assert.throws(() => h.store.dispatch(rec(h.f)), /保存失败/);
  assert.equal(h.session.status().pending, 0);
  assert.equal(typeof h.store.clear, 'function');
});

test('cloud backup includes pending operations while CSV excludes notes by default', async () => {
  const h = await setup();
  h.store.dispatch(rec(h.f, 'note', { note: '私人测试' }));
  assert.ok(!h.store.exportCsv(false).includes('私人测试'));
  assert.ok(h.store.exportCsv(true).includes('私人测试'));
  assert.equal(JSON.parse(h.store.rawBackup()).current.queue.length, 1);
});

function pages(h) {
  const modals = [], toasts = [], navigation = [];
  global.wx = { ...h.wx, showModal: value => modals.push(value), showToast: value => toasts.push(value),
    setNavigationBarTitle() {}, navigateTo: value => navigation.push(value),
    switchTab: value => navigation.push(value), navigateBack: () => navigation.push('back') };
  global.getApp = () => ({ store: h.store, cloudSession: h.session });
  return {
    modals, toasts, navigation,
    page(name, options = {}) {
      let definition;
      global.Page = value => { definition = value; };
      const source = path.resolve(__dirname, '../miniprogram/pages/' + name + '/index.js');
      delete require.cache[source];
      require(source);
      const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)),
        setData(patch) { Object.assign(this.data, patch); } };
      if (page.onLoad) page.onLoad(options);
      page.refresh();
      return page;
    }
  };
}

test('today and progress use only the cloud cache and expose pending sync status', async () => {
  const h = await setup();
  const app = pages(h);
  const today = app.page('today');
  today.onComplete({ currentTarget: { dataset: { id: 'read', date: h.f.date, done: false } } });
  assert.equal(today.data.done, 1);
  assert.match(app.toasts[0].title, /待同步/);
  assert.match(today.data.syncText, /待同步/);
  assert.equal(app.page('progress').data.stats.done, 1);
});

test('edit waits for cloud confirmation and ignores a duplicate save while busy', async () => {
  const release = deferred();
  let block = false;
  const h = await setup(async (event, f) => {
    if (block && event.action === 'mutate') await release.promise;
    return f.api(event);
  });
  const app = pages(h);
  const edit = app.page('edit', { template: 'study' });
  block = true;
  const save = edit.onSave();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(edit.data.saving, true);
  assert.equal(app.navigation.length, 0);
  edit.onSave();
  release.resolve();
  await save;
  assert.equal(app.navigation.length, 1);
  assert.equal(app.toasts[0].title, '已保存');
  assert.equal(h.calls.filter(event => event.action === 'mutate').length, 1);
});

test('edit failure stays in the form and never reports a saved habit', async () => {
  let fail = false;
  const h = await setup((event, f) => {
    if (fail) throw Error('offline');
    return f.api(event);
  });
  const app = pages(h);
  const edit = app.page('edit', { template: 'read' });
  fail = true;
  await edit.onSave();
  assert.equal(app.navigation.length, 0);
  assert.equal(app.toasts.length, 0);
  assert.equal(edit.data.saving, false);
  assert.match(edit.data.error, /offline/);
});

test('pages opened under one account cannot write after the verified account changes', async () => {
  const h = await setup();
  const app = pages(h);
  const edit = app.page('edit', { template: 'read' });
  const today = app.page('today');
  h.f.identity.OPENID = 'another-user';
  await h.session.start();
  await edit.onSave();
  assert.match(edit.data.error, /数据状态已变化/);
  today.onComplete({ currentTarget: { dataset: { id: 'read', date: h.f.date, done: false } } });
  assert.match(today.data.error, /数据状态已变化/);
  assert.equal(h.session.status().pending, 0);
});

test('placeholder environment never reaches transport even when enabled', async () => {
  let called = false;
  const session = createCloudSession(storageFixture(), { enabled: true, envId: 'YOUR_CLOUD_ENV_ID' },
    () => () => { called = true; });
  await assert.rejects(session.acceptConsent(true), /尚未配置/);
  assert.equal(called, false);
});
