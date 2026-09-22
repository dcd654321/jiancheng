const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, plan, domain, dates } = require('./helpers/cloud-fixture.cjs');
const { createRepository, isMissingDocument } = require('../server/cloudbase-repository');
const { createCloudTransport } = require('../miniprogram/services/cloud-transport');

test('云端身份只接受服务端上下文，拒绝错误AppID、缺失身份和客户端身份字段', async () => {
  const f = fixture();
  assert.equal((await f.api({ action: 'pull' }, {})).code, 'UNAUTHORIZED');
  assert.equal((await f.api({ action: 'pull' }, { APPID: 'other', OPENID: 'user' })).code, 'UNAUTHORIZED');
  assert.equal((await f.api({ action: 'pull', userId: 'victim' })).code, 'INVALID_REQUEST');
  assert.equal(f.db.size, 0);
});
test('云端仅接受小程序客户端和开发者工具来源，拒绝HTTP或其他云端调用', async () => {
  const f = fixture();
  for (const SOURCE of [undefined, 'http', 'cloud', 'wx_server']) {
    const identity = { ...f.identity, SOURCE };
    assert.equal((await f.api({ action: 'pull' }, identity)).code, 'UNAUTHORIZED');
  }
  assert.equal((await f.api({ action: 'pull' }, { ...f.identity, SOURCE: 'wx_devtools' })).ok, true);
  assert.equal((await f.api({ action: 'pull' }, { ...f.identity, SOURCE: 'wx_client' })).ok, true);
});
test('不同用户获得独立数据，知道习惯ID也不能改他人的记录', async () => {
  const f = fixture(), a = await f.seed();
  const bIdentity = { ...f.identity, OPENID: 'test_user_b' };
  const b = await f.api({ action: 'pull' }, bIdentity);
  assert.notEqual(a.accountId, b.accountId); assert.equal(b.state.habits.length, 0);
  const response = await f.api(f.request(b, { type: 'complete', id: 'read', date: f.date }), bIdentity);
  assert.equal(response.code, 'INVALID_COMMAND');
  assert.equal((await f.pull()).state.habits.length, 1);
});
test('云端结构白名单、长度限制和危险属性名拒绝无效输入', async () => {
  const f = fixture(), initial = await f.pull();
  for (const command of [
    { type: 'create', id: 'constructor', plan: plan() },
    { type: 'create', id: 'read', plan: plan({ target: '5' }) },
    { type: 'create', id: 'read', plan: { ...plan(), ownerId: 'victim' } },
    { type: '__proto__' }, { type: 'complete', id: 'read', date: f.date, ownerId: 'victim' }
  ]) assert.equal((await f.api(f.request(initial, command))).ok, false);
  const oversized = f.request(initial, { type: 'note', id: 'read', date: f.date, note: '字'.repeat(5000) });
  assert.equal((await f.api(oversized)).code, 'INVALID_REQUEST');
  assert.equal((await f.pull()).revision, 0);
});
test('请求超时后同ID同内容重试只写一次，跨午夜仍确认成功', async () => {
  const f = fixture(), initial = await f.seed();
  const request = f.request(initial, { type: 'complete', id: 'read', date: f.date });
  const first = await f.api(request); f.date = dates.shift(f.date, 1);
  const replay = await f.api(request);
  assert.equal(first.revision, initial.revision + 1); assert.equal(replay.replayed, true);
  assert.equal(replay.revision, first.revision); assert.equal(Object.keys(replay.state.records).length, 1);
});
test('同请求ID换内容会拒绝，不把撤销误认为旧的完成重试', async () => {
  const f = fixture(), initial = await f.seed();
  const request = f.request(initial, { type: 'complete', id: 'read', date: f.date });
  await f.api(request);
  const changed = await f.api({ ...request, command: { ...request.command, type: 'undo' } });
  assert.equal(changed.code, 'IDEMPOTENCY_MISMATCH');
  assert.equal((await f.pull()).state.records['read@' + f.date].status, 'standard');
});
test('并发请求只允许一个匹配版本写入，另一个返回冲突快照', async () => {
  const f = fixture(), initial = await f.seed();
  const results = await Promise.all([
    f.api(f.request(initial, { type: 'complete', id: 'read', date: f.date })),
    f.api(f.request(initial, { type: 'note', id: 'read', date: f.date, note: '第二设备' }))
  ]);
  assert.equal(results.filter(r => r.ok).length, 1);
  assert.equal(results.filter(r => r.code === 'CONFLICT').length, 1);
  assert.equal(results.find(r => !r.ok).snapshot.revision, initial.revision + 1);
});
test('原日离线记录在7天窗口内可以同步，并标记延迟', async () => {
  const f = fixture(), initial = await f.seed(), original = f.date;
  const request = f.request(initial, { type: 'complete', id: 'read', date: original });
  f.date = dates.shift(original, 6);
  const result = await f.api(request); assert.equal(result.ok, true);
  assert.equal(result.state.records['read@' + original].delayedSync, true);
  assert.equal(result.state.records['read@' + f.date], undefined);
});
test('超过恢复窗口或未来日期拒绝，长期修改跨日需重新确认', async () => {
  const f = fixture(), initial = await f.seed(), original = f.date;
  const request = f.request(initial, { type: 'complete', id: 'read', date: original });
  f.date = dates.shift(original, 7);
  assert.equal((await f.api(request)).code, 'EXPIRED_OPERATION');
  const future = dates.shift(f.date, 1);
  assert.equal((await f.api(f.request(initial, { type: 'complete', id: 'read', date: future }, { operationDate: future }))).code, 'FUTURE_DATE');
  assert.equal((await f.api(f.request(initial, { type: 'edit', id: 'read', baseRevision: 1, plan: plan() }, { operationDate: original }))).code, 'RECONFIRM_REQUIRED');
});
test('删除需要确认，保留最小代际标识防止旧设备复活数据', async () => {
  const f = fixture(), initial = await f.seed();
  const late = f.request(initial, { type: 'complete', id: 'read', date: f.date });
  const purge = { action: 'purge', operationId: 'purge-1', epoch: initial.epoch, expectedRevision: initial.revision, operationDate: f.date };
  assert.equal((await f.api(purge)).code, 'CONFIRMATION_REQUIRED');
  const deletion = await f.api({ ...purge, confirmation: 'DELETE_MY_DATA' });
  assert.equal(deletion.ok, true); assert.notEqual(deletion.epoch, initial.epoch); assert.equal(deletion.state.habits.length, 0);
  assert.equal((await f.api(late)).code, 'EPOCH_CHANGED');
  assert.equal((await f.api({ ...purge, confirmation: 'DELETE_MY_DATA' })).replayed, true);
});
test('存储失败原子回滚，重试不因残留回执漏写', async () => {
  const f = fixture(), initial = await f.seed();
  const request = f.request(initial, { type: 'complete', id: 'read', date: f.date });
  f.failWrite = true; assert.equal((await f.api(request)).code, 'SERVICE_UNAVAILABLE');
  f.failWrite = false;
  const result = await f.api(request); assert.equal(result.replayed, false); assert.equal(result.revision, initial.revision + 1);
});
test('坏账户不能被空状态覆盖，错误不暴露原始数据', async () => {
  const f = fixture(), initial = await f.seed();
  f.db.get(initial.accountId).state.schemaVersion = 99;
  const result = await f.pull(); assert.equal(result.code, 'SERVICE_UNAVAILABLE');
  assert.equal(result.state, undefined); assert.equal(f.db.get(initial.accountId).state.schemaVersion, 99);
  assert.doesNotMatch(JSON.stringify(result), /test_user|schemaVersion|stack/);
});
test('旧回执淘汰后，旧版本仍拒绝重放，不重复修改', async () => {
  const f = fixture(), initial = await f.seed();
  const first = f.request(initial, { type: 'complete', id: 'read', date: f.date });
  await f.api(first);
  for (let i = 0; i < 257; i++) await f.mutate({ type: 'settings', hideQuote: i % 2 === 0 });
  assert.equal((await f.api(first)).code, 'CONFLICT');
  assert.ok(f.db.get(initial.accountId).receipts.length <= 256);
});
test('账户容量到上限时停止写入，不清理用户历史凑空间', async () => {
  const f = fixture(), initial = await f.seed();
  const account = f.db.get(initial.accountId);
  account.state.padding = 'x'.repeat(701 * 1024);
  const result = await f.api(f.request(initial, { type: 'complete', id: 'read', date: f.date }));
  assert.equal(result.code, 'CAPACITY_LIMIT'); assert.equal(f.db.get(initial.accountId).revision, initial.revision);
});
test('共享领域层拒绝原型键名，统计不会污染Object原型', () => {
  for (const id of ['__proto__', 'constructor', 'prototype']) assert.throws(() => domain.reduce(domain.emptyState(), { type: 'create', id, plan: plan() }, '2026-09-10'));
  assert.equal(Object.prototype.planned, undefined);
});
test('数据库适配器只将明确文档不存在视为空，不吞掉权限或集合错误', () => {
  assert.equal(isMissingDocument(Error('document with _id abc does not exist')), true);
  for (const message of ['collection does not exist', 'permission denied document does not exist', 'network error', 'timeout']) assert.equal(isMissingDocument(Error(message)), false);
});
test('数据库适配器兼容事务返回包装，失败不写空文档', async () => {
  let saved = null, sets = 0, mode = 'missing';
  const db = { runTransaction: async callback => ({ result: await callback({ collection: () => ({ doc: () => ({
    get: async () => { if (mode === 'missing') throw Error('document does not exist'); if (mode === 'denied') throw Error('permission denied'); return { data: { payload: saved } }; },
    set: async ({ data }) => { saved = data.payload; sets++; }
  }) }) }) }) };
  const repository = createRepository(db);
  const result = await repository.transact('owner', async previous => ({ account: previous || { version: 1 }, result: { ok: true } }));
  assert.equal(result.ok, true); assert.equal(sets, 1);
  mode = 'valid'; await repository.transact('owner', async previous => ({ account: previous, result: { ok: true } })); assert.equal(sets, 1);
  mode = 'denied'; await assert.rejects(() => repository.transact('owner', async () => ({ account: {}, result: { ok: true } }))); assert.equal(sets, 1);
});
test('云传输必须明确启用且同意；构造时不联网', async () => {
  let initializations = 0, calls = 0;
  const wx = { cloud: { init: () => initializations++, callFunction: async options => { calls++; assert.equal(options.name, 'jiancheng_daka_api'); return { result: { ok: true } }; } } };
  assert.throws(() => createCloudTransport(wx, { enabled: true, envId: 'test-env', consent: false }));
  const transport = createCloudTransport(wx, { enabled: true, envId: 'test-env', consent: true });
  assert.equal(calls, 0); assert.equal(initializations, 0);
  await transport({ action: 'pull' }); await transport({ action: 'pull' });
  assert.equal(initializations, 1); assert.equal(calls, 2);
});
