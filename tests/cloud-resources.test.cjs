const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { storageFixture, fixture } = require('./helpers/cloud-fixture.cjs');
const { createCloudBinding, cloudStorageScope } = require('../miniprogram/services/cloud-binding');
const { createCloudSession } = require('../miniprogram/services/cloud-session');
const { createCloudTransport } = require('../miniprogram/services/cloud-transport');

test('渐成打卡所有新云资源使用同一专属前缀，构建目录与数据库目标一致', () => {
  const names = require('../miniprogram/config/cloud-resources');
  assert.equal(names.prefix, 'jiancheng_daka_');
  assert.equal(names.apiFunction, 'jiancheng_daka_api');
  assert.equal(names.planFunction, 'jiancheng_daka_plan');
  assert.equal(names.accountsCollection, 'jiancheng_daka_accounts');
  for (const name of [names.apiFunction, names.planFunction, names.accountsCollection]) {
    assert.ok(name.startsWith(names.prefix));
    assert.match(name, /^[a-z][a-z0-9_]{0,59}$/);
  }
  assert.equal(require('../server/cloudbase-repository').COLLECTION, names.accountsCollection);
  const root = path.resolve(__dirname, '../cloudfunctions', names.apiFunction);
  assert.ok(fs.existsSync(path.join(root, 'index.js')));
  assert.equal(require(path.join(root, 'lib/cloudbase-repository')).COLLECTION, names.accountsCollection);
  assert.equal(require(path.join(root, 'package.json')).name, 'jiancheng-daka-api');
  assert.equal(require(path.join(root, 'package-lock.json')).name, 'jiancheng-daka-api');
  const legacyFunction = path.resolve(__dirname, '../cloudfunctions/habitApi');
  assert.equal(fs.existsSync(path.join(legacyFunction, 'index.js')), false);
  assert.equal(fs.existsSync(path.join(legacyFunction, 'package.json')), false);
  assert.equal(require('../miniprogram/config/ai').functionName, names.planFunction);
  assert.equal(require('../miniprogram/config/ai').enabled, false);
});

test('未识别product实际环境前不切换运行目标，旧测试调用与缓存保持不变', () => {
  const current = require('../miniprogram/config/cloud');
  assert.deepEqual(current, { enabled: true, envId: 'cloud1-d4gq76oyt363f08a7', functionName: 'habitApi' });
  const product = require('../miniprogram/config/cloud.product');
  assert.equal(product.enabled, false);
  assert.equal(product.envId, '');
  assert.equal(product.functionName, 'jiancheng_daka_api');
  assert.equal(product.storageNamespace, 'jiancheng_daka');
  assert.equal(cloudStorageScope(current.envId), 'yidian.cloud.env:' + current.envId + ':');
});

test('正式云调用使用前缀函数和明确环境，不自动回退到旧函数', async () => {
  const calls = [], init = [];
  const wx = { cloud: { init: options => init.push(options), callFunction: async options => {
    calls.push(options); throw Error('FUNCTION_NOT_FOUND');
  } } };
  const invoke = createCloudTransport(wx, { enabled: true, envId: 'product-test-id', consent: true });
  await assert.rejects(invoke({ action: 'pull' }), /FUNCTION_NOT_FOUND/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'jiancheng_daka_api');
  assert.equal(calls[0].config.env, 'product-test-id');
  assert.deepEqual(init, [{ env: 'product-test-id', traceUser: false }]);
});

test('旧环境兼容调用需明确配置，非法函数名在联网前拒绝', async () => {
  const calls = [];
  const wx = { cloud: { init() {}, callFunction: async options => { calls.push(options); return { result: { ok: true } }; } } };
  await createCloudTransport(wx, { enabled: true, envId: 'test-id', consent: true, functionName: 'habitApi' })({ action: 'pull' });
  assert.equal(calls[0].name, 'habitApi');
  for (const name of ['', '../habitApi', 'bad/name', 1]) {
    assert.throws(() => createCloudTransport(wx, { enabled: true, envId: 'test-id', consent: true, functionName: name }), /函数名称/);
  }
  assert.equal(calls.length, 1);
});

test('同环境不同数据命名空间不共享授权或账户绑定，旧键不搬迁不删除', () => {
  const wx = storageFixture();
  const old = createCloudBinding(wx, 'same-env');
  old.accept(); old.bind('a'.repeat(64));
  const before = Array.from(wx.values);
  const next = createCloudBinding(wx, 'same-env', 'jiancheng_daka');
  assert.equal(next.consented(), false);
  assert.equal(next.accountId(), '');
  assert.notEqual(next.keys.consent, old.keys.consent);
  assert.deepEqual(Array.from(wx.values), before);
  next.accept(); next.bind('b'.repeat(64));
  assert.equal(old.accountId(), 'a'.repeat(64));
  assert.equal(next.accountId(), 'b'.repeat(64));
  assert.throws(() => createCloudBinding(wx, 'same-env', 'a:b'), /命名空间/);
});

test('正式会话不读取或上传同环境旧集合的确认缓存与待同步队列', async () => {
  const wx = storageFixture(), f = fixture();
  f.date = require('../miniprogram/core/date').today();
  await f.seed();
  let calls = 0, offline = false;
  const transportFactory = () => async event => { calls++; if (offline) throw Error('OFFLINE'); return f.api(event); };
  const old = createCloudSession(wx, { enabled: true, envId: 'same-env' }, transportFactory);
  await old.acceptConsent(true);
  assert.equal(old.read().habits.length, 1);
  offline = true;
  old.dispatch({ type: 'note', id: 'read', date: f.date, note: 'legacy pending note' });
  await old.onForeground();
  assert.equal(old.status().pending, 1);
  const before = Array.from(wx.values);
  const next = createCloudSession(wx, { enabled: true, envId: 'same-env', functionName: 'jiancheng_daka_api', storageNamespace: 'jiancheng_daka' }, transportFactory);
  const callsBefore = calls;
  assert.equal(next.status().ready, false);
  assert.equal(next.status().consented, false);
  await next.start();
  assert.equal(calls, callsBefore);
  assert.deepEqual(Array.from(wx.values), before);
  assert.throws(() => next.read(), /同意/);
});

test('product空环境保持关闭，启动不会联系任何环境或迁移数据', async () => {
  const wx = storageFixture();
  let calls = 0;
  const session = createCloudSession(wx, require('../miniprogram/config/cloud.product'), () => async () => { calls++; });
  assert.equal(session.status().configured, false);
  await session.start();
  await assert.rejects(session.acceptConsent(true), /尚未配置/);
  assert.equal(calls, 0);
  assert.equal(wx.values.size, 0);
});
