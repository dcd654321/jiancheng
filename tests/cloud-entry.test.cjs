const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { plan } = require('./helpers/cloud-fixture.cjs');

function entryFixture() {
  const entry = path.resolve(__dirname, '../cloudfunctions/jiancheng_daka_api/index.js');
  const realRequire = createRequire(entry), saved = new Map();
  const f = { identity: { APPID: 'wx-entry-test', OPENID: 'trusted-user', SOURCE: 'wx_devtools' }, transactions: 0 };
  const repository = { async transact(owner, operation) {
    f.transactions++;
    const outcome = await operation(saved.has(owner) ? structuredClone(saved.get(owner)) : null);
    saved.set(owner, structuredClone(outcome.account));
    return outcome.result;
  } };
  const sdk = { init() {}, database() {
    if (f.failDatabase) throw Error('SDK_PRIVATE_DATABASE_DETAIL');
    return {};
  }, getWXContext() {
    if (f.failContext) throw Error('SDK_PRIVATE_IDENTITY_DETAIL');
    return f.identity;
  } };
  const env = { HABIT_APP_ID: 'wx-entry-test', HABIT_MINIPROGRAM_ONLY: 'true', HABIT_API_ENABLED: 'true' };
  const exports = {};
  const requireStub = name => name === 'wx-server-sdk' ? sdk :
    name === './lib/cloudbase-repository' ? { createRepository: () => repository } : realRequire(name);
  new Function('require', 'exports', 'process', fs.readFileSync(entry, 'utf8'))(requireStub, exports, { env });
  return Object.assign(f, { main: exports.main, env });
}

test('真实入口忽略微信附带的userInfo和tcbContext，账户身份只取可信上下文', async () => {
  const f = entryFixture();
  const event = { action: 'pull', userInfo: { appId: 'forged-app', openId: 'forged-user' },
    tcbContext: { OPENID: 'forged-user', APPID: 'forged-app' } };
  const result = await f.main(event);
  assert.equal(result.ok, true);
  assert.equal(result.accountId, (await f.main({ action: 'pull' })).accountId);
  assert.equal(event.userInfo.openId, 'forged-user');
  assert.doesNotMatch(JSON.stringify(result), /forged-user|forged-app/);
});

test('移除平台元数据后仍拒绝未知字段、危险属性及非普通请求对象', async () => {
  const f = entryFixture();
  for (const event of [
    { action: 'pull', userInfo: {}, ownerId: 'victim' },
    JSON.parse('{"action":"pull","userInfo":{},"__proto__":{}}'),
    Object.assign(Object.create({ inherited: true }), { action: 'pull', userInfo: {} }),
    [], null
  ]) assert.equal((await f.main(event)).code, 'INVALID_REQUEST');
  assert.equal(f.transactions, 0);
  const probe = await f.main({ action: 'deployment_probe', userInfo: {}, tcbContext: {} });
  assert.equal(probe.message, '不支持的请求');
  assert.equal(probe.diagnostic, undefined);
  assert.equal(f.transactions, 0);
});

test('平台元数据不能替代缺失的可信身份或绕过来源限制', async () => {
  const f = entryFixture();
  for (const identity of [{}, { ...f.identity, SOURCE: 'http' }, { ...f.identity, APPID: 'other-app' }]) {
    f.identity = identity;
    assert.equal((await f.main({ action: 'pull', userInfo: { appId: 'wx-entry-test', openId: 'trusted-user' },
      tcbContext: { APPID: 'wx-entry-test', OPENID: 'trusted-user', SOURCE: 'wx_client' } })).code, 'UNAUTHORIZED');
  }
  assert.equal(f.transactions, 0);
});

test('共享环境跨账号调用按FROM_*认定调用方，身份与本环境调用等价且资源方来源被拒', async () => {
  const f = entryFixture();
  const local = await f.main({ action: 'pull', userInfo: {} });
  f.identity = { APPID: 'wx7ad85943fe81e095', OPENID: '', SOURCE: 'wx_client',
    FROM_APPID: 'wx-entry-test', FROM_OPENID: 'trusted-user' };
  const shared = await f.main({ action: 'pull', userInfo: {} });
  assert.equal(shared.ok, true);
  assert.equal(shared.accountId, local.accountId);
  for (const identity of [
    { ...f.identity, FROM_APPID: 'wx-other-app' },
    { ...f.identity, FROM_OPENID: '' },
    { ...f.identity, FROM_OPENID: 12 },
    { ...f.identity, SOURCE: 'http' },
    { APPID: 'wx7ad85943fe81e095', OPENID: 'resource-user', SOURCE: 'wx_client' }
  ]) { f.identity = identity; assert.equal((await f.main({ action: 'pull' })).code, 'UNAUTHORIZED'); }
  assert.doesNotMatch(JSON.stringify(shared), /wx7ad85943fe81e095|trusted-user/);
});

test('平台元数据变化不改变同一业务请求的幂等指纹', async () => {
  const f = entryFixture(), initial = await f.main({ action: 'pull', userInfo: {} });
  const request = { action: 'mutate', operationId: 'entry-create-1', epoch: initial.epoch,
    expectedRevision: initial.revision, operationDate: initial.serverDate,
    command: { type: 'create', id: 'entry-read', startDate: initial.serverDate, plan: plan() } };
  const first = await f.main({ ...request, userInfo: { openId: 'first-value' }, tcbContext: { requestId: 'first' } });
  const replay = await f.main({ ...request, userInfo: { openId: 'different-value' }, tcbContext: { requestId: 'retry' } });
  assert.equal(first.ok, true);
  assert.equal(replay.ok, true);
  assert.equal(replay.replayed, true);
  assert.equal(replay.revision, first.revision);
  assert.equal(replay.state.habits.length, 1);
});

test('服务端开关关闭时入口不访问事务仓库', async () => {
  const f = entryFixture();
  f.env.HABIT_API_ENABLED = 'false';
  assert.equal((await f.main({ action: 'pull', userInfo: {} })).code, 'NOT_ENABLED');
  assert.equal(f.transactions, 0);
});

test('云端关闭提示不再承诺本机可用，云端故障不退回本地', async () => {
  const f = entryFixture();
  f.env.HABIT_API_ENABLED = 'false';
  f.failDatabase = true;
  const result = await f.main({ action: 'pull' });
  assert.equal(result.code, 'NOT_ENABLED');
  assert.doesNotMatch(result.message, /本机|本地/);
  assert.equal(f.transactions, 0);
});

test('云函数数据库初始化与可信上下文异常均返回安全业务错误', async () => {
  for (const field of ['failDatabase', 'failContext']) {
    const f = entryFixture();
    f[field] = true;
    const result = await f.main({ action: 'pull' });
    assert.deepEqual(result, { ok: false, code: 'SERVICE_UNAVAILABLE', message: '云端服务暂不可用，请稍后重试确认' });
    assert.doesNotMatch(JSON.stringify(result), /SDK_PRIVATE|trusted-user/);
    assert.equal(f.transactions, 0);
    f[field] = false;
    assert.equal((await f.main({ action: 'pull' })).ok, true, '故障解除后可重试');
  }
});
