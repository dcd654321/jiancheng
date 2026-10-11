const test = require('node:test');
const assert = require('node:assert/strict');
const { createCloudTransport } = require('../miniprogram/services/cloud-transport');
const { createCloudSession } = require('../miniprogram/services/cloud-session');
const { createApi } = require('../server/handler');
const { createRepository } = require('../server/cloudbase-repository');
const { fixture, domain, dates, copy } = require('./helpers/cloud-fixture.cjs');
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const target = { enabled: true, mode: 'shared', resourceAppid: 'wx1234567890abcdef', envId: 'test-cloud', functionName: 'jiancheng_daka_api' };

test('core and appearance transports share one initialized connection while keeping function names separate', async () => {
  const gate = deferred(), created = [], calls = []; let inits = 0;
  const wx = { cloud: { Cloud: class {
    constructor(config) { created.push(config); }
    init() { inits++; return gate.promise; }
    async callFunction(event) { calls.push(event); return { result: { ok: true } }; }
  } } };
  const core = createCloudTransport(wx, target), appearance = createCloudTransport(wx, { ...target, functionName: 'jiancheng_daka_features' });
  assert.deepEqual(created, []);
  const first = core({ action: 'pull' }), second = appearance({ action: 'getAppearance' }); await Promise.resolve();
  assert.equal(created.length, 1); assert.equal(inits, 1); assert.deepEqual(calls, []);
  gate.resolve(); await Promise.all([first, second]);
  assert.deepEqual(calls.map(call => call.name), ['jiancheng_daka_api', 'jiancheng_daka_features']);
  await createCloudTransport(wx, { ...target, functionName: 'jiancheng_daka_public_share' })({ action: 'getPublicShare' });
  assert.equal(inits, 1); assert.equal(calls[2].name, 'jiancheng_daka_public_share');
});

test('connection reuse cannot cross wx API objects, environments or shared resource owners', async () => {
  const created = [];
  const wx = () => ({ cloud: { Cloud: class {
    constructor(config) { created.push(config); }
    async init() {} async callFunction() { return { result: { ok: true } }; }
  } } });
  const first = wx(), second = wx();
  await createCloudTransport(first, target)({ action: 'pull' });
  await createCloudTransport(first, { ...target, envId: 'another-cloud' })({ action: 'pull' });
  await createCloudTransport(first, { ...target, resourceAppid: 'wxfedcba0987654321' })({ action: 'pull' });
  await createCloudTransport(second, target)({ action: 'pull' });
  assert.equal(created.length, 4);
});

test('shared failed initialization is cleared for both clients and retried once without fallback', async () => {
  let inits = 0, calls = 0;
  const wx = { cloud: { init() { throw Error('default forbidden'); }, callFunction() { throw Error('default forbidden'); }, Cloud: class {
    async init() { if (++inits === 1) return { errCode: 403 }; return { errCode: 0 }; }
    async callFunction() { calls++; return { result: { ok: true } }; }
  } } };
  const core = createCloudTransport(wx, target), appearance = createCloudTransport(wx, { ...target, functionName: 'jiancheng_daka_features' });
  for (const result of await Promise.allSettled([core({ action: 'pull' }), appearance({ action: 'getAppearance' })])) {
    assert.equal(result.status, 'rejected'); assert.equal(result.reason.code, 'SHARED_CLOUD_PERMISSION_DENIED');
  }
  assert.equal(inits, 1); assert.equal(calls, 0);
  await Promise.all([core({ action: 'pull' }), appearance({ action: 'getAppearance' })]);
  assert.equal(inits, 2); assert.equal(calls, 2);
});

test('a slow startup or completion is fresh from confirmation time, without an immediate extra pull', async () => {
  const f = fixture(); f.date = dates.today(); await f.seed();
  let time = Date.parse(f.date + 'T04:00:00Z'); const calls = [];
  const session = createCloudSession({}, { enabled: true, envId: 'test-cloud' }, () => async event => {
    calls.push(event.action); time += 35000; return f.api(event);
  }, { now: () => time });
  await session.start(); await session.onForeground(); assert.deepEqual(calls, ['pull']);
  await session.dispatch({ type: 'complete', id: 'read', date: f.date }); await session.onForeground();
  assert.deepEqual(calls, ['pull', 'mutate']); assert.equal(session.read().records['read@' + f.date].status, 'standard');
  time += 29999; await session.onForeground(); assert.deepEqual(calls, ['pull', 'mutate']);
  time++; await session.onForeground(); assert.deepEqual(calls, ['pull', 'mutate', 'pull']);
  await session.onForeground(true); assert.deepEqual(calls, ['pull', 'mutate', 'pull', 'pull']);
});

test('successful write receipt validates the state once, while invalid receipts remain pending', async t => {
  const f = fixture(); f.date = dates.today(); await f.seed(); const before = await f.pull();
  const event = f.request(before, { type: 'complete', id: 'read', date: f.date }, { operationId: 'latency-validation' });
  const result = await f.api(event);
  const session = createCloudSession({}, { enabled: true, envId: 'test-cloud' }, () => async event => event.action === 'pull' ? before : result,
    { now: () => Date.parse(f.date + 'T04:00:00Z'), newId: () => 'latency-validation' });
  await session.start(); let validations = 0; const original = domain.validateState;
  domain.validateState = state => { validations++; return original(state); }; t.after(() => { domain.validateState = original; });
  await session.dispatch(event.command); assert.equal(validations, 1); assert.equal(session.status().pending, 0);
  const invalid = createCloudSession({}, { enabled: true, envId: 'test-cloud' }, () => async event => event.action === 'pull' ? before : { ...result, state: { ...result.state, records: [] } },
    { now: () => Date.parse(f.date + 'T04:00:00Z'), newId: () => 'latency-validation' });
  await invalid.start(); await assert.rejects(invalid.dispatch(event.command)); assert.equal(invalid.status().pending, 1);
});

test('strict repository read distinguishes missing documents from corrupt data, permissions and invalid responses', async () => {
  let response = { data: [] }, failure;
  const repository = createRepository({ collection: name => { assert.equal(name, 'jiancheng_daka_accounts'); return {
    doc: owner => { assert.equal(owner, 'owner'); return { get: async () => { if (failure) throw failure; return response; } }; }
  }; } });
  assert.equal(await repository.read('owner'), null);
  response = { data: { payload: { epoch: 'test' } } }; assert.deepEqual(await repository.read('owner'), { epoch: 'test' });
  response = { data: { wrong: true } }; await assert.rejects(repository.read('owner'), /CORRUPT/);
  for (const invalid of [{}, { data: undefined }, { data: false }, { data: 'invalid' }, { data: [null] }, { data: [false] }, { data: [[]] }, { data: [{ payload: {} }, { payload: {} }] }]) {
    response = invalid; await assert.rejects(repository.read('owner'), /READ_INVALID/);
  }
  failure = Error('document does not exist'); assert.equal(await repository.read('owner'), null);
  for (const message of ['permission denied', 'collection does not exist', 'network failure']) {
    failure = Error(message); await assert.rejects(repository.read('owner'), { message });
  }
});

test('cleanup-pending fast read falls through to the transaction and keeps existing cleanup gates', async () => {
  const owner = require('node:crypto').createHash('sha256').update('wx-app:openid').digest('hex');
  const account = { epoch: 'epoch-a', revision: 0, state: domain.emptyState(), receipts: [], cleanupPending: true, cleanupSourceEpoch: 'old-epoch' };
  let reads = 0, transactions = 0;
  const api = createApi({ domain, dates, allowedAppId: 'wx-app', allowedSources: ['wx_client'], repository: {
    read: async id => { assert.equal(id, owner); reads++; return copy(account); },
    transact: async (id, operation) => { transactions++; return (await operation(copy(account))).result; }
  } });
  const result = await api({ action: 'pull' }, { APPID: 'wx-app', OPENID: 'openid', SOURCE: 'wx_client' });
  assert.equal(result.code, 'DELETE_PENDING'); assert.equal(reads, 1); assert.equal(transactions, 1); assert.equal(account.cleanupPending, true);
});
