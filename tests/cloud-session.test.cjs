const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { fixture, dates } = require('./helpers/cloud-fixture.cjs');
const { createCloudSession } = require('../miniprogram/services/cloud-session');

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const forbiddenStorage = () => ({
  getStorageSync() { throw Error('device read forbidden'); },
  setStorageSync() { throw Error('device write forbidden'); },
  removeStorageSync() { throw Error('device delete forbidden'); },
  getFileSystemManager() { throw Error('device file forbidden'); }
});

async function setup(route) {
  const f = fixture(); f.date = dates.today(); await f.seed();
  const calls = [], wx = forbiddenStorage();
  const factory = () => async event => { calls.push(JSON.parse(JSON.stringify(event))); return route ? route(event, f) : f.api(event); };
  const config = { enabled: true, envId: 'cloud-only-test' };
  const session = createCloudSession(wx, config, factory);
  return { f, wx, calls, factory, config, session };
}

test('cold start and restart each pull cloud data; no device storage API is touched', async () => {
  const h = await setup();
  assert.equal(h.session.status().ready, false);
  assert.throws(() => h.session.read(), /尚未读取/);
  await h.session.start();
  assert.equal(h.session.read().habits[0].id, 'read');
  const second = createCloudSession(h.wx, h.config, h.factory);
  assert.equal(second.status().ready, false);
  await second.start();
  assert.equal(second.read().habits[0].id, 'read');
  assert.deepEqual(h.calls.map(call => call.action), ['pull', 'pull']);
});

test('failed read and offline status hide prior in-memory snapshot instead of showing editable cache', async () => {
  let offline = false;
  const h = await setup((event, f) => offline ? Promise.reject(Error('offline')) : f.api(event));
  await h.session.start();
  offline = true;
  await assert.rejects(h.session.refresh(), /offline/);
  assert.equal(h.session.status().ready, false);
  assert.throws(() => h.session.read(), /offline/);
  assert.throws(() => h.session.dispatch({ type: 'complete', id: 'read', date: h.f.date }), /offline/);
  offline = false;
  await h.session.refresh();
  assert.equal(h.session.status().ready, true);
});

test('direct mutation is not displayed until matching cloud receipt; only one mutation may be in flight', async () => {
  const gate = deferred(); let seen;
  const h = await setup(async (event, f) => {
    if (event.action === 'mutate') { seen = event; await gate.promise; }
    return f.api(event);
  });
  await h.session.start();
  const pending = h.session.dispatch({ type: 'complete', id: 'read', date: h.f.date });
  assert.equal(h.session.status().pending, 1);
  assert.equal(h.session.read().records[`read@${h.f.date}`], undefined);
  assert.throws(() => h.session.dispatch({ type: 'note', id: 'read', date: h.f.date, note: 'x' }), /上一操作|正在处理/);
  assert.equal(seen.action, 'mutate');
  gate.resolve(); await pending;
  assert.equal(h.session.status().pending, 0);
  assert.equal(h.session.read().records[`read@${h.f.date}`].status, 'standard');
});

test('lost response stays unconfirmed and retries the exact operation id in this app session', async () => {
  let lost = true;
  const h = await setup(async (event, f) => {
    const result = await f.api(event);
    if (event.action === 'mutate' && lost) { lost = false; throw Error('response lost'); }
    return result;
  });
  await h.session.start();
  await assert.rejects(h.session.dispatch({ type: 'complete', id: 'read', date: h.f.date }), /未确认/);
  assert.equal(h.session.status().ready, false);
  assert.equal(h.session.status().pending, 1);
  assert.throws(() => h.session.read(), /未确认/);
  await h.session.retry();
  const mutations = h.calls.filter(call => call.action === 'mutate');
  assert.equal(mutations.length, 2);
  assert.deepEqual(mutations[0], mutations[1]);
  assert.equal((await h.f.pull()).revision, h.session.status().count + 1);
  assert.equal(h.session.read().records[`read@${h.f.date}`].status, 'standard');
});

test('restart after a lost acknowledgement pulls the cloud result without repeating the write', async () => {
  let lost = true;
  const h = await setup(async (event, f) => {
    const result = await f.api(event);
    if (event.action === 'mutate' && lost) { lost = false; throw Error('response lost'); }
    return result;
  });
  await h.session.start();
  await assert.rejects(h.session.dispatch({ type: 'complete', id: 'read', date: h.f.date }));
  const restarted = createCloudSession(h.wx, h.config, h.factory);
  await restarted.start();
  assert.equal(restarted.read().records[`read@${h.f.date}`].status, 'standard');
  assert.equal(h.calls.filter(call => call.action === 'mutate').length, 1);
});

test('conflict never reports the local command as saved; cloud snapshot becomes authoritative', async () => {
  const h = await setup(); await h.session.start();
  await h.f.mutate({ type: 'note', id: 'read', date: h.f.date, note: '另一设备' });
  await assert.rejects(h.session.dispatch({ type: 'complete', id: 'read', date: h.f.date }), /另一设备/);
  assert.equal(h.session.status().pending, 0);
  assert.equal(h.session.read().records[`read@${h.f.date}`].note, '另一设备');
  assert.equal(h.session.read().records[`read@${h.f.date}`].status, 'pending');
});

test('purge requires confirmation and only empties state after cloud acknowledgement', async () => {
  const h = await setup(); await h.session.start();
  await assert.rejects(h.session.purge(''), /确认/);
  await h.session.purge('DELETE_MY_DATA');
  assert.equal(h.session.read().habits.length, 0);
  assert.equal(h.calls.filter(call => call.action === 'purge').length, 1);
});

test('actual sync page retries a failed cloud read without consent, file or backup actions', async () => {
  let offline = true;
  const h = await setup((event, f) => offline ? Promise.reject(Error('offline')) : f.api(event));
  global.wx = forbiddenStorage(); global.wx.navigateTo = () => {};
  global.getApp = () => ({ cloudSession: h.session });
  let definition; global.Page = page => { definition = page; };
  const source = path.resolve(__dirname, '../miniprogram/pages/sync/index.js');
  delete require.cache[source]; require(source);
  const page = { ...definition, data: { ...definition.data }, setData(patch) { Object.assign(this.data, patch); } };
  page.onShow();
  await assert.rejects(h.session.start(), /offline/);
  page.refresh(); assert.equal(page.data.dataUnavailable, true);
  offline = false; await page.onRefresh();
  assert.equal(page.data.ready, true);
  for (const obsolete of ['onConsentAndStart', 'onBackup', 'onResend', 'onUseRemote']) assert.equal(page[obsolete], undefined);
  page.onUnload();
});
