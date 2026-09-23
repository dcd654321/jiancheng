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

test('已核实正式资源标识但保持关闭，旧测试调用与缓存保持不变', () => {
  const current = require('../miniprogram/config/cloud');
  assert.deepEqual(current, { enabled: true, envId: 'cloud1-d4gq76oyt363f08a7', functionName: 'habitApi' });
  const product = require('../miniprogram/config/cloud.product');
  assert.equal(product.enabled, false);
  assert.equal(product.mode, 'shared');
  assert.equal(product.envId, 'product-d2g59zty74d7d1ec1');
  assert.equal(product.resourceAppid, 'wx7ad85943fe81e095');
  assert.equal(product.functionName, 'jiancheng_daka_api');
  assert.equal(product.storageNamespace, 'jiancheng_daka');
  assert.equal(cloudStorageScope(current.envId), 'yidian.cloud.env:' + current.envId + ':');
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
  const config = { ...require('../miniprogram/config/cloud.product'), enabled: true, consent: true };
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

test('共享云配置、同意和目标错误在任何业务调用前拒绝', async () => {
  let instances = 0, calls = 0;
  const wx = { cloud: { Cloud: class {
    constructor() { instances++; }
    async init() {}
    async callFunction() { calls++; return { result: { ok: true } }; }
  } } };
  const good = { ...require('../miniprogram/config/cloud.product'), enabled: true, consent: true };
  for (const config of [
    { ...good, consent: false }, { ...good, enabled: false },
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
  const invoke = createCloudTransport(wx, { ...require('../miniprogram/config/cloud.product'), enabled: true, consent: true });
  await assert.rejects(invoke({ action: 'pull' }), /SHARED_INIT_OFFLINE/);
  assert.equal(calls, 0);
  assert.deepEqual(await invoke({ action: 'pull' }), { ok: true });
  assert.equal(attempts, 2);
  assert.equal(calls, 1);
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

test('product虽有资源标识但保持关闭，启动不会联系任何环境或迁移数据', async () => {
  const wx = storageFixture();
  let calls = 0;
  const session = createCloudSession(wx, require('../miniprogram/config/cloud.product'), () => async () => { calls++; });
  assert.equal(session.status().configured, false);
  await session.start();
  await assert.rejects(session.acceptConsent(true), /尚未配置/);
  assert.equal(calls, 0);
  assert.equal(wx.values.size, 0);
});

test('共享会话配置不完整时不进入可编辑空账户，也不联网', async () => {
  const wx = storageFixture();
  let calls = 0;
  const invalid = { ...require('../miniprogram/config/cloud.product'), enabled: true, resourceAppid: '' };
  const session = createCloudSession(wx, invalid, () => async () => { calls++; });
  assert.equal(session.status().configured, false);
  assert.equal(session.status().ready, false);
  await assert.rejects(session.acceptConsent(true), /尚未配置/);
  assert.equal(session.status().ready, false);
  assert.throws(() => session.read(), /同意/);
  assert.equal(calls, 0);
});

test('旧测试待同步操作留在旧范围，正式首次离线后恢复不重放旧操作', async () => {
  const wx = storageFixture();
  const oldCloud = fixture(), formalCloud = fixture();
  oldCloud.date = formalCloud.date = require('../miniprogram/core/date').today();
  await oldCloud.seed();
  let oldOffline = false, formalOffline = true;
  const old = createCloudSession(wx, require('../miniprogram/config/cloud'),
    () => async event => { if (oldOffline) throw Error('OLD_OFFLINE'); return oldCloud.api(event); });
  await old.acceptConsent(true);
  oldOffline = true;
  old.dispatch({ type: 'note', id: 'read', date: oldCloud.date, note: '旧队列' });
  await old.onForeground();
  assert.equal(old.status().pending, 1);

  const formalConfig = { ...require('../miniprogram/config/cloud.product'), enabled: true };
  const formalCalls = [];
  const formal = createCloudSession(wx, formalConfig, () => async event => {
    formalCalls.push(event);
    if (formalOffline) throw Error('FORMAL_OFFLINE');
    return formalCloud.api(event);
  });
  assert.equal(formal.status().consented, false);
  await assert.rejects(formal.acceptConsent(true), /FORMAL_OFFLINE/);
  assert.equal(formal.status().ready, false);
  formalOffline = false;
  await formal.start();
  assert.equal(formal.status().ready, true);
  assert.equal(formal.status().pending, 0);
  assert.equal(formal.read().habits.length, 0);
  assert.ok(formalCalls.every(event => event.action === 'pull'));
  assert.equal(old.status().pending, 1);
  const oldScope = cloudStorageScope(require('../miniprogram/config/cloud').envId);
  const formalScope = cloudStorageScope(formalConfig.envId, formalConfig.storageNamespace);
  assert.notEqual(oldScope, formalScope);
  assert.ok(Array.from(wx.values.keys()).some(key => key.startsWith(oldScope)));
  assert.ok(Array.from(wx.values.keys()).some(key => key.startsWith(formalScope)));
});
