const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { storageFixture, fixture } = require('./helpers/cloud-fixture.cjs');
const { createCloudBinding, cloudStorageScope } = require('./legacy/cloud-binding.cjs');
const { createCloudSession } = require('../miniprogram/services/cloud-session');
const { createCloudTransport } = require('../miniprogram/services/cloud-transport');
const cloudConfig = require('../miniprogram/config/cloud');
const testTarget = cloudConfig.TARGETS.test;
const productTarget = cloudConfig.TARGETS.product;

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
  assert.equal(require('../miniprogram/config/ai').enabled, true);
});

test('目标按版本解析：开发/体验连共享测试环境，正式连共享正式环境，缓存范围独立', () => {
  for (const version of ['develop', 'trial', undefined]) {
    assert.deepEqual(cloudConfig.resolveCloudConfig(version), testTarget);
  }
  assert.deepEqual(cloudConfig.resolveCloudConfig('release'), productTarget);
  assert.equal(testTarget.envId, 'cloud1-d8gopnalv908bb47a');
  assert.equal(productTarget.envId, 'product-d2g59zty74d7d1ec1');
  for (const target of [testTarget, productTarget]) {
    assert.equal(target.enabled, true);
    assert.equal(target.mode, 'shared');
    assert.equal(target.resourceAppid, 'wx7ad85943fe81e095');
    assert.equal(target.functionName, 'jiancheng_daka_api');
    assert.equal(target.storageNamespace, 'jiancheng_daka');
  }
  // Node（无 wx）按 develop 解析，与小程序内同一条路径
  assert.equal(cloudConfig.envId, testTarget.envId);
  assert.equal(cloudStorageScope(cloudConfig.envId, cloudConfig.storageNamespace), 'yidian.cloud.env:' + cloudConfig.envId + ':app:jiancheng_daka:');
  assert.notEqual(cloudStorageScope(cloudConfig.envId, cloudConfig.storageNamespace), cloudStorageScope(cloudConfig.envId));
});

test('共享云先等独立实例初始化，合并并发请求且绝不回退默认云', async () => {
  const instances = [], initCalls = [], calls = [];
  let releaseInit;
  const initGate = new Promise(resolve => { releaseInit = resolve; });
  const wx = { cloud: {
    init() { throw Error('不得初始化默认云'); },
    callFunction() { throw Error('不得调用默认云'); },
    Cloud: class {
      constructor(options) { instances.push(options); }
      init() { initCalls.push(true); return initGate; }
      async callFunction(options) { calls.push(options); return { result: { ok: true } }; }
    }
  } };
  const config = { ...productTarget, enabled: true };
  const invoke = createCloudTransport(wx, config);
  assert.equal(instances.length, 0);
  const first = invoke({ action: 'pull' });
  const second = invoke({ action: 'pull' });
  await Promise.resolve();
  assert.deepEqual(instances, [{ resourceAppid: config.resourceAppid, resourceEnv: config.envId }]);
  assert.equal(initCalls.length, 1);
  assert.equal(calls.length, 0);
  releaseInit();
  assert.deepEqual(await Promise.all([first, second]), [{ ok: true }, { ok: true }]);
  assert.deepEqual(calls, [
    { name: 'jiancheng_daka_api', data: { action: 'pull' } },
    { name: 'jiancheng_daka_api', data: { action: 'pull' } }
  ]);
});

test('共享云配置和目标错误在任何业务调用前拒绝', async () => {
  let instances = 0, calls = 0;
  const wx = { cloud: { Cloud: class {
    constructor() { instances++; }
    async init() {}
    async callFunction() { calls++; return { result: { ok: true } }; }
  } } };
  const good = { ...productTarget, enabled: true };
  for (const config of [
    { ...good, enabled: false },
    { ...good, envId: '' }, { ...good, resourceAppid: '' },
    { ...good, resourceAppid: 'wx-bad' }, { ...good, functionName: 'habitApi' },
    { ...good, mode: 'typo' }
  ]) assert.throws(() => createCloudTransport(wx, config));
  assert.equal(instances, 0);
  assert.equal(calls, 0);
  assert.throws(() => createCloudTransport({ cloud: {} }, good), /共享云实例/);
});

test('共享云初始化失败可再次尝试，不回退旧环境也不伪造成功', async () => {
  let attempts = 0, calls = 0;
  const wx = { cloud: {
    init() { throw Error('不得回退默认云'); },
    callFunction() { throw Error('不得回退默认云'); },
    Cloud: class {
      async init() { if (++attempts === 1) throw Error('SHARED_INIT_OFFLINE'); }
      async callFunction() { calls++; return { result: { ok: true } }; }
    }
  } };
  const invoke = createCloudTransport(wx, { ...productTarget, enabled: true });
  await assert.rejects(invoke({ action: 'pull' }), /SHARED_INIT_OFFLINE/);
  assert.equal(calls, 0);
  assert.deepEqual(await invoke({ action: 'pull' }), { ok: true });
  assert.equal(attempts, 2);
  assert.equal(calls, 1);
});

test('共享初始化 resolve 403 时并发共同失败，不调用业务且不泄露原始错误，随后可重试', async () => {
  let attempts = 0, calls = 0, release;
  const firstInit = new Promise(resolve => { release = resolve; });
  const wx = { cloud: {
    init() { throw Error('不得回退默认云'); },
    callFunction() { throw Error('不得调用默认云'); },
    Cloud: class {
      init() { return ++attempts === 1 ? firstInit : Promise.resolve({ errCode: 0 }); }
      async callFunction() { calls++; return { result: { ok: true } }; }
    }
  } };
  const invoke = createCloudTransport(wx, { ...productTarget, enabled: true });
  const outcomes = Promise.allSettled([invoke({ action: 'pull' }), invoke({ action: 'pull' })]);
  await Promise.resolve();
  assert.equal(attempts, 1);
  release({ errCode: 403, errMsg: 'PRIVATE_RAW_AUTH_DETAIL', auth: 'PRIVATE_AUTH_VALUE' });
  for (const outcome of await outcomes) {
    assert.equal(outcome.status, 'rejected');
    assert.equal(outcome.reason.code, 'SHARED_CLOUD_PERMISSION_DENIED');
    assert.equal(outcome.reason.message, '正式云共享权限尚未开通，请联系开发者处理');
    assert.doesNotMatch(String(outcome.reason) + JSON.stringify(outcome.reason), /PRIVATE_/);
  }
  assert.equal(calls, 0);
  assert.deepEqual(await invoke({ action: 'pull' }), { ok: true });
  assert.equal(attempts, 2);
  assert.equal(calls, 1);
});

test('共享初始化显式错误码必须为数值零，异常码不透传且不发业务请求', async () => {
  for (const errCode of [-1, 500, '0', '403', null, undefined, NaN, {}]) {
    let calls = 0;
    const wx = { cloud: { Cloud: class {
      async init() { return { errCode, errMsg: 'PRIVATE_RAW_DETAIL' }; }
      async callFunction() { calls++; return { result: { ok: true } }; }
    } } };
    const invoke = createCloudTransport(wx, { ...productTarget, enabled: true });
    await assert.rejects(invoke({ action: 'pull' }), error => {
      assert.equal(error.code, 'SHARED_CLOUD_INIT_FAILED');
      assert.equal(error.message, '云服务初始化失败，请稍后重试');
      assert.doesNotMatch(String(error), /PRIVATE_/);
      return true;
    });
    assert.equal(calls, 0);
  }
});

test('正式云调用使用前缀函数和明确环境，不自动回退到旧函数', async () => {
  const calls = [], init = [];
  const wx = { cloud: { init: options => init.push(options), callFunction: async options => {
    calls.push(options); throw Error('FUNCTION_NOT_FOUND');
  } } };
  const invoke = createCloudTransport(wx, { enabled: true, envId: 'product-test-id' });
  await assert.rejects(invoke({ action: 'pull' }), /FUNCTION_NOT_FOUND/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'jiancheng_daka_api');
  assert.equal(calls[0].config.env, 'product-test-id');
  assert.deepEqual(init, [{ env: 'product-test-id', traceUser: false }]);
});

test('旧环境兼容调用需明确配置，非法函数名在联网前拒绝', async () => {
  const calls = [];
  const wx = { cloud: { init() {}, callFunction: async options => { calls.push(options); return { result: { ok: true } }; } } };
  await createCloudTransport(wx, { enabled: true, envId: 'test-id', functionName: 'habitApi' })({ action: 'pull' });
  assert.equal(calls[0].name, 'habitApi');
  for (const name of ['', '../habitApi', 'bad/name', 1]) {
    assert.throws(() => createCloudTransport(wx, { enabled: true, envId: 'test-id', functionName: name }), /函数名称/);
  }
  assert.equal(calls.length, 1);
});

test('同环境不同数据命名空间不共享账户绑定，旧键不搬迁不删除', () => {
  const wx = storageFixture();
  const old = createCloudBinding(wx, 'same-env');
  old.bind('a'.repeat(64));
  const before = Array.from(wx.values);
  const next = createCloudBinding(wx, 'same-env', 'jiancheng_daka');
  assert.equal(next.accountId(), '');
  assert.notEqual(next.keys.binding, old.keys.binding);
  assert.deepEqual(Array.from(wx.values), before);
  next.bind('b'.repeat(64));
  assert.equal(old.accountId(), 'a'.repeat(64));
  assert.equal(next.accountId(), 'b'.repeat(64));
  assert.throws(() => createCloudBinding(wx, 'same-env', 'a:b'), /命名空间/);
});

test('正式会话不会读取同设备上的旧绑定或待同步键', async () => {
  const wx = storageFixture(), f = fixture();
  f.date = require('../miniprogram/core/date').today();
  await f.seed();
  wx.setStorageSync('yidian.cloud.binding.v1', 'old-account');
  wx.setStorageSync('yidian.sync.v1:old-account', 'old-queue');
  const before = Array.from(wx.values);
  wx.getStorageSync = () => { throw Error('old device data read'); };
  wx.setStorageSync = () => { throw Error('old device data write'); };
  wx.removeStorageSync = () => { throw Error('old device data delete'); };
  const session = createCloudSession(wx, { enabled: true, envId: 'same-env', functionName: 'jiancheng_daka_api', storageNamespace: 'jiancheng_daka' }, () => event => f.api(event));
  await session.start();
  assert.equal(session.read().habits.length, 1);
  assert.deepEqual(Array.from(wx.values), before);
});

test('正式目标会话可配置、经共享传输启动且不落设备数据', async () => {
  const wx = storageFixture(), f = fixture();
  f.date = require('../miniprogram/core/date').today();
  await f.seed();
  const calls = [];
  const session = createCloudSession(wx, productTarget,
    () => event => { calls.push(event); return f.api(event); });
  assert.equal(session.status().configured, true);
  await session.start();
  assert.equal(session.read().habits.length, 1);
  assert.ok(calls.every(event => event.action === 'pull'));
  assert.equal(wx.values.size, 0);
});

test('共享会话配置不完整时不进入可编辑空账户，也不联网', async () => {
  const wx = storageFixture();
  let calls = 0;
  const invalid = { ...productTarget, enabled: true, resourceAppid: '' };
  const session = createCloudSession(wx, invalid, () => async () => { calls++; });
  assert.equal(session.status().configured, false);
  assert.equal(session.status().ready, false);
  assert.equal((await session.start()).lastError, '云环境尚未配置');
  assert.equal(session.status().ready, false);
  assert.throws(() => session.read(), /云环境尚未配置/);
  assert.equal(calls, 0);
});

test('正式会话启动只读正式云，不重放旧运行会话的未确认请求', async () => {
  const wx = storageFixture(), oldCloud = fixture(), formalCloud = fixture();
  oldCloud.date = formalCloud.date = require('../miniprogram/core/date').today();
  await oldCloud.seed();
  let oldOffline = false, formalOffline = true;
  const old = createCloudSession(wx, testTarget,
    () => event => oldOffline ? Promise.reject(Error('OLD_OFFLINE')) : oldCloud.api(event));
  await old.start(); oldOffline = true;
  await assert.rejects(old.dispatch({ type: 'note', id: 'read', date: oldCloud.date, note: '未确认' }));
  assert.equal(old.status().pending, 1);
  const formalCalls = [];
  const formal = createCloudSession(wx, { ...productTarget, enabled: true },
    () => event => { formalCalls.push(event); return formalOffline ? Promise.reject(Error('FORMAL_OFFLINE')) : formalCloud.api(event); });
  await assert.rejects(formal.start(), /FORMAL_OFFLINE/);
  formalOffline = false; await formal.start();
  assert.equal(formal.status().pending, 0);
  assert.equal(formal.read().habits.length, 0);
  assert.ok(formalCalls.every(event => event.action === 'pull'));
});
