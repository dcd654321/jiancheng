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

test('a late pull receipt cannot make the page writable after an offline notification', async () => {
  const gate = deferred(); let delay = true;
  const h = await setup(async (event, f) => {
    const result = await f.api(event);
    if (delay) await gate.promise;
    return result;
  });
  const work = h.session.start();
  await new Promise(setImmediate);
  h.session.setNetworkAvailable(false);
  gate.resolve(); await work;
  const store = require('../miniprogram/services/workspace-store').createWorkspaceStore(h.session);
  assert.equal(h.session.status().networkOffline, true);
  assert.equal(h.session.status().phase, 'offline');
  assert.equal(store.info().ready, false);
  assert.equal(store.stale().habits[0].id, 'read', '合法回执保留为会话内只读数据');
  assert.throws(() => store.read(), /无网络/);
  assert.throws(() => store.dispatch({ type: 'complete', id: 'read', date: h.f.date }), /无网络/);
  assert.equal(h.calls.length, 1, '断网后未发出新写入');
  delay = false; h.session.setNetworkAvailable(true);
  await h.session.recoverConnection();
  assert.equal(store.info().ready, true, '联网恢复重新读取后正常解锁');
  assert.equal(store.read().habits[0].id, 'read');
});

test('a late matching write receipt confirms the operation but keeps the snapshot read-only while offline', async () => {
  const gate = deferred();
  const h = await setup(async (event, f) => {
    const result = await f.api(event);
    if (event.action === 'mutate') await gate.promise;
    return result;
  });
  await h.session.start();
  const work = h.session.dispatch({ type: 'complete', id: 'read', date: h.f.date });
  await new Promise(setImmediate);
  h.session.setNetworkAvailable(false);
  gate.resolve(); await work;
  assert.equal(h.session.status().pending, 0, '匹配回执确认完成，不能保留未知结果');
  assert.equal(h.session.status().ready, false);
  assert.equal(h.session.status().phase, 'offline');
  assert.equal(h.session.staleRead().records[`read@${h.f.date}`].status, 'standard');
  assert.throws(() => h.session.dispatch({ type: 'undo', id: 'read', date: h.f.date }), /无网络/);
  h.session.setNetworkAvailable(true);
  await h.session.recoverConnection();
  assert.equal(h.session.status().ready, true);
  assert.equal(h.session.read().records[`read@${h.f.date}`].status, 'standard');
  assert.equal(h.calls.filter(call => call.action === 'mutate').length, 1, '恢复读取不重复已确认写入');
});

test('a late conflict snapshot remains authoritative without overriding the offline state', async () => {
  const gate = deferred();
  const h = await setup(async (event, f) => {
    const result = await f.api(event);
    if (event.action === 'mutate') await gate.promise;
    return result;
  });
  await h.session.start();
  await h.f.mutate({ type: 'note', id: 'read', date: h.f.date, note: '另一设备的新备注' });
  const work = h.session.dispatch({ type: 'complete', id: 'read', date: h.f.date });
  const rejected = assert.rejects(work, /另一设备/);
  await new Promise(setImmediate);
  h.session.setNetworkAvailable(false);
  gate.resolve(); await rejected;
  assert.equal(h.session.status().pending, 0);
  assert.equal(h.session.status().ready, false);
  assert.equal(h.session.status().phase, 'offline');
  const record = h.session.staleRead().records[`read@${h.f.date}`];
  assert.equal(record.note, '另一设备的新备注');
  assert.equal(record.status, 'pending', '拒绝的本次打卡不能被显示为保存');
  h.session.setNetworkAvailable(true);
  await h.session.recoverConnection();
  assert.equal(h.session.status().ready, true);
});

test('a late explicit refusal without snapshot keeps confirmed data visible and read-only while offline', async () => {
  const gate = deferred();
  const h = await setup(async (event, f) => {
    if (event.action !== 'mutate') return f.api(event);
    await gate.promise;
    return { ok: false, code: 'RECONFIRM_REQUIRED', message: '日期已变更，请重新确认' };
  });
  await h.session.start();
  const work = h.session.dispatch({ type: 'complete', id: 'read', date: h.f.date });
  const rejected = assert.rejects(work, /日期已变更/);
  await new Promise(setImmediate);
  h.session.setNetworkAvailable(false);
  gate.resolve(); await rejected;
  const info = h.session.status();
  assert.equal(info.pending, 0, '明确拒绝后无需重复发送该操作');
  assert.equal(info.ready, false);
  assert.equal(info.phase, 'offline');
  assert.equal(info.stale, true, '已有已确认快照仍可只读呈现');
  assert.equal(h.session.staleRead().habits[0].id, 'read');
  assert.equal(h.session.staleRead().records[`read@${h.f.date}`], undefined);
  assert.throws(() => h.session.read(), /日期已变更/);
  h.session.setNetworkAvailable(true);
  await h.session.recoverConnection();
  assert.equal(h.session.status().ready, true);
  assert.equal(h.calls.filter(call => call.action === 'mutate').length, 1);
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
  const store = require('../miniprogram/services/workspace-store').createWorkspaceStore(h.session);
  global.getApp = () => ({ cloudSession: h.session, store });
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
