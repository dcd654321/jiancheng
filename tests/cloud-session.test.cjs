const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { fixture, storageFixture, dates } = require('./helpers/cloud-fixture.cjs');
const { createCloudSession } = require('../miniprogram/services/cloud-session');
const { PREFIX } = require('../miniprogram/services/sync-engine');
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function setup({ route, now } = {}) {
  const f = fixture();
  f.date = dates.today();
  const snapshot = await f.seed(), wx = storageFixture(), requests = [];
  const stats = { active: 0, maxConcurrent: 0, mutationIds: [] };
  const factory = () => async event => {
    requests.push(JSON.parse(JSON.stringify(event)));
    stats.active += 1;
    stats.maxConcurrent = Math.max(stats.maxConcurrent, stats.active);
    if (event.action === 'mutate') stats.mutationIds.push(event.operationId);
    try { return route ? await route(event, f) : await f.api(event); }
    finally { stats.active -= 1; }
  };
  const config = { enabled: true, envId: 'test-env' };
  const session = createCloudSession(wx, config, factory, { now });
  const key = 'yidian.cloud.env:test-env:' + PREFIX + snapshot.accountId;
  return { f, snapshot, wx, requests, stats, factory, config, session, key };
}
async function readySetup(options = {}) {
  const h = await setup(options);
  await h.session.acceptConsent(true);
  h.requests.length = 0;
  h.stats.maxConcurrent = 0;
  h.stats.mutationIds.length = 0;
  return h;
}
function injectQueue(h) {
  const cache = JSON.parse(h.wx.getStorageSync(h.key));
  cache.queue.push({ event: { action: 'mutate', operationId: 'offline-test', epoch: cache.base.epoch,
    expectedRevision: cache.base.revision, operationDate: h.f.date,
    command: { type: 'complete', id: 'read', date: h.f.date } } });
  h.wx.setStorageSync(h.key, JSON.stringify(cache));
}

test('start does not connect before consent; acceptance pulls and persists a resumable cache', async () => {
  const h = await setup();
  assert.equal((await h.session.start()).phase, 'needsConsent');
  assert.equal(h.requests.length, 0);
  const ready = await h.session.acceptConsent(true);
  assert.equal(ready.phase, 'ready');
  assert.deepEqual(h.requests, [{ action: 'pull' }]);
  const resumed = createCloudSession(h.wx, h.config, h.factory);
  assert.equal(resumed.status().ready, true);
  assert.equal(resumed.read().habits[0].id, 'read');
  assert.equal(h.requests.length, 1);
});

test('failed first pull has no editable state; failed refresh with cache stays offline', async () => {
  const h = await setup();
  let offline = true;
  const session = createCloudSession(h.wx, h.config, () => async event => {
    if (offline) throw Error('offline');
    return h.f.api(event);
  });
  await assert.rejects(session.acceptConsent(true), /offline/);
  assert.equal(session.status().ready, false);
  offline = false;
  await session.start();
  assert.equal(session.status().ready, true);
  offline = true;
  await session.start();
  assert.equal(session.status().phase, 'offline');
  assert.equal(session.read().habits.length, 1);
});

test('record dispatch is durable before one background flush and reuses its operation id', async () => {
  const started = deferred(), release = deferred();
  const h = await readySetup({ route: async (event, f) => {
    if (event.action === 'mutate') { started.resolve(); await release.promise; }
    return f.api(event);
  } });
  const projected = h.session.dispatch({ type: 'complete', id: 'read', date: h.f.date });
  assert.equal(projected.records['read@' + h.f.date].status, 'standard');
  assert.equal(h.session.status().pending, 1);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.stats.mutationIds.length, 1, 'the durable queue should start one background mutation');
  await started.promise;
  h.session.dispatch({ type: 'note', id: 'read', date: h.f.date, note: '继续' });
  assert.equal(h.session.status().pending, 2);
  assert.equal(h.stats.maxConcurrent, 1);
  release.resolve();
  await h.session.onForeground();
  assert.equal(h.session.status().pending, 0);
  assert.equal(new Set(h.stats.mutationIds).size, 2);
});

test('foreground does not poll before 30 seconds but refreshes once when stale', async () => {
  let currentTime = 100000;
  const h = await readySetup({ now: () => currentTime });
  const pulls = h.requests.filter(event => event.action === 'pull').length;
  await h.session.onForeground();
  assert.equal(h.requests.filter(event => event.action === 'pull').length, pulls);
  currentTime += 31000;
  await h.session.onForeground();
  assert.equal(h.requests.filter(event => event.action === 'pull').length, pulls + 1);
});

test('automatic foreground work stops after a visible conflict', async () => {
  let currentTime = 100000;
  const h = await readySetup({ now: () => currentTime });
  await h.f.mutate({ type: 'note', id: 'read', date: h.f.date, note: '另一设备' });
  h.session.dispatch({ type: 'complete', id: 'read', date: h.f.date });
  await h.session.onForeground();
  assert.ok(h.session.status().conflict);
  const callsAtConflict = h.requests.length;
  currentTime += 60000;
  await h.session.onForeground();
  assert.equal(h.requests.length, callsAtConflict);
});

test('session purge is cloud-confirmed before the local snapshot becomes empty', async () => {
  const h = await readySetup();
  await assert.rejects(h.session.purge(''), /确认/);
  const result = await h.session.purge('DELETE_MY_DATA');
  assert.equal(result.state.habits.length, 0);
  assert.equal(h.session.status().pending, 0);
  assert.equal(h.requests.filter(event => event.action === 'purge').length, 1);
});

test('云会话构造及状态读取不联网，默认关闭且必须显式同意', async () => {
  const h = await setup(); assert.equal(h.session.status().connected, false); assert.equal(h.requests.length, 0);
  await assert.rejects(h.session.acceptConsent(false), /同意/); assert.equal(h.requests.length, 0);
  const disabled = createCloudSession(h.wx, { enabled: false, envId: '' }, h.factory);
  await assert.rejects(disabled.acceptConsent(true), /尚未配置/); assert.equal(h.requests.length, 0);
});

test('首次连接仅读取云端且不触碰本机记录，重启直接恢复已确认缓存', async () => {
  const h = await setup(); h.wx.setStorageSync('yidian.native.v1', 'original');
  const status = await h.session.acceptConsent(true);
  assert.equal(status.connected, true); assert.equal(status.count, 1);
  assert.deepEqual(h.requests, [{ action: 'pull' }]);
  assert.equal(h.wx.getStorageSync('yidian.native.v1'), 'original');
  const restarted = createCloudSession(h.wx, h.config, h.factory);
  assert.equal(restarted.status().connected, true);
  assert.equal(restarted.read().habits[0].id, 'read');
  assert.equal(h.requests.length, 1);
});

test('相同账户的不同云环境缓存隔离', async () => {
  const h = await setup(); await h.session.acceptConsent(true); injectQueue(h);
  const other = createCloudSession(h.wx, { ...h.config, envId: 'other-env' }, h.factory);
  assert.equal((await other.acceptConsent(true)).pending, 0);
  assert.equal(h.session.status().pending, 1);
});

test('重启读取不自动上传已有队列，只有retry提交', async () => {
  const h = await setup(); await h.session.acceptConsent(true); injectQueue(h);
  h.requests.length = 0;
  const restarted = createCloudSession(h.wx, h.config, h.factory);
  assert.equal(restarted.status().pending, 1);
  await restarted.start(); assert.ok(h.requests.every(e => e.action === 'pull'));
  assert.equal(restarted.status().conflict, null);
  assert.equal((await restarted.retry()).pending, 0);
  assert.equal(h.requests.filter(e => e.action === 'mutate').length, 1);
});

test('冲突需要确认；采用远端不改变本机store且备份包含待同步内容', async () => {
  const h = await setup(); await h.session.acceptConsent(true); injectQueue(h);
  h.wx.setStorageSync('yidian.native.v1', 'keep');
  await h.f.mutate({ type: 'note', id: 'read', date: h.f.date, note: '远端修改' });
  assert.ok((await h.session.refresh()).conflict);
  await assert.rejects(h.session.useRemote(''), /明确确认/);
  await h.session.useRemote('DISCARD_PENDING');
  const backup = JSON.parse(h.session.backup());
  assert.equal(backup.recovery.queue.length, 1); assert.equal(backup.current.queue.length, 0);
  assert.equal(h.wx.getStorageSync('yidian.native.v1'), 'keep');
});

test('账户变化不会读取上一账户队列，读取失败保留最后确认快照', async () => {
  const h = await setup(); await h.session.acceptConsent(true); injectQueue(h);
  const previous = h.wx.getStorageSync(h.key);
  h.f.identity.OPENID = 'another_user';
  assert.equal((await h.session.start()).pending, 0);
  assert.equal(h.wx.getStorageSync(h.key), previous);
  h.f.identity.APPID = 'wrong-app';
  const offline = await h.session.start();
  assert.equal(offline.phase, 'offline'); assert.equal(offline.ready, true);
});

test('处理中拒绝重复启动，正式接口不提供断开连接', async () => {
  const h = await setup(), started = deferred(), release = deferred();
  const session = createCloudSession(h.wx, h.config, () => async e => { started.resolve(); await release.promise; return h.f.api(e); });
  const connection = session.acceptConsent(true); await started.promise;
  assert.equal(session.disconnect, undefined); await assert.rejects(session.start(), /稍候/);
  release.resolve(); await connection;
  assert.ok(h.wx.getStorageSync(h.key));
  const unopened = createCloudSession(storageFixture(), h.config, h.factory);
  await assert.rejects(unopened.retry(), /先阅读/); assert.throws(() => unopened.backup(), /先阅读/);
});

test('坏缓存与缓存保存失败不覆盖原记录，不标记连接成功', async () => {
  const h = await setup(); h.wx.setStorageSync(h.key, '{broken');
  await assert.rejects(h.session.acceptConsent(true), /损坏/);
  assert.equal(h.session.status().connected, false); assert.equal(h.wx.getStorageSync(h.key), '{broken');
  h.wx.values.delete(h.key); h.wx.failWrite = true;
  await assert.rejects(h.session.acceptConsent(true), /保存失败/); assert.equal(h.session.status().connected, false);
});

function pageHarness(session) {
  const modals = [], files = [], sends = [];
  global.wx = { showModal: x => modals.push(x), env: { USER_DATA_PATH: '/files' },
    getFileSystemManager: () => ({ writeFile: x => { files.push(x); x.success(); } }),
    shareFileMessage: x => sends.push(x) };
  global.getApp = () => ({ cloudSession: session });
  let definition; global.Page = value => { definition = value; };
  const source = path.resolve(__dirname, '../miniprogram/pages/sync/index.js');
  delete require.cache[source]; require(source);
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch) { Object.assign(this.data, patch); } };
  page.onShow(); return { page, modals, files, sends };
}

test('真实同步页控制器：打开不联网，一次同意后开始读取且没有数据源开关', async () => {
  const h = await setup(), { page } = pageHarness(h.session);
  assert.equal(h.requests.length, 0);
  assert.equal(page.data.needsConsent, true);
  await page.onConsentAndStart();
  assert.equal(page.data.ready, true); assert.equal(page.data.busy, false); assert.equal(page.data.error, '');
  assert.equal(page.onConnect, undefined);
  assert.equal(page.onDisconnect, undefined);
  assert.equal(page.onUseCloud, undefined);
  assert.equal(page.onUseLocal, undefined);
});

test('真实同步页控制器：冲突取消不变，确认后备份可导出，发送失败不称成功', async () => {
  const h = await setup(); await h.session.acceptConsent(true); injectQueue(h);
  await h.f.mutate({ type: 'note', id: 'read', date: h.f.date, note: '远端' }); await h.session.refresh();
  const { page, modals, files, sends } = pageHarness(h.session);
  page.onUseRemote(); modals.pop().success({ confirm: false }); assert.equal(h.session.status().pending, 1);
  page.onUseRemote(); modals.pop().success({ confirm: true });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(page.data.pending, 0);
  page.onBackup(); assert.equal(JSON.parse(files[0].data).recovery.queue.length, 1);
  assert.equal(sends[0].fileName, '渐成习惯打卡云同步备份.json');
  sends[0].fail(); assert.match(page.data.error, /发送未完成/);
  page.onResend(); assert.equal(sends[1].fileName, sends[0].fileName);
});

test('真实同步页控制器：请求异常恢复按钮，离开页面后不再setData', async () => {
  const status = () => ({ configured: true, consented: false, ready: false, phase: 'needsConsent', busy: false });
  const broken = { status, acceptConsent: async () => { throw Error('网络失败'); } };
  const { page } = pageHarness(broken); await page.onConsentAndStart(); assert.equal(page.data.busy, false); assert.equal(page.data.error, '网络失败');
  const release = deferred(); broken.acceptConsent = () => release.promise;
  const attempt = page.onConsentAndStart(); page.onUnload(); page.setData = () => { throw Error('unloaded'); };
  release.resolve(); await attempt;
});
