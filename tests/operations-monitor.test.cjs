const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createOperationsMonitor } = require('../miniprogram/services/operations-monitor');
const { createCloudTransport } = require('../miniprogram/services/cloud-transport');
const { createCloudSession } = require('../miniprogram/services/cloud-session');
const { createApi } = require('../server/handler');
const { createOperationsReporter, createOperationsCleanup } = require('../server/operations-monitor');
const { createRepository } = require('../server/cloudbase-repository');
const { domain, dates, plan, copy } = require('./helpers/cloud-fixture.cjs');
const tick = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

function clientFixture({ initialNow = 0 } = {}) {
  let now = initialNow, scope = 'account:epoch-a', serial = 0, listener;
  const calls = [], scheduled = new Map(), listeners = {};
  const f = { calls, scheduled, fail: false, wxApi: {
    onError(fn) { listeners.error = fn; }, offError(fn) { if (listeners.error === fn) delete listeners.error; },
    onUnhandledRejection(fn) { listeners.rejection = fn; }, offUnhandledRejection(fn) { if (listeners.rejection === fn) delete listeners.rejection; }
  } };
  const monitor = createOperationsMonitor(f.wxApi, {}, {
    now: () => now, newId: () => 'session_' + (++serial), contextKey: () => scope,
    accountGeneration: () => scope.split(':').slice(-1)[0],
    timers: { setTimeout(fn, delay) { const id = ++serial; scheduled.set(id, { fn, at: now + delay }); return id; }, clearTimeout(id) { scheduled.delete(id); } },
    subscribe(fn) { listener = fn; return () => { listener = null; }; },
    route: () => 'pages/today/index', envVersion: () => 'release',
    transportFactory: () => async event => {
      calls.push(copy(event)); if (f.fail) throw Error('private-sentinel');
      return f.respond ? f.respond(copy(event), now) : { ok: true };
    }
  });
  f.monitor = monitor;
  f.scope = value => { scope = value; if (listener) listener(); };
  f.advance = async ms => {
    const end = now + ms;
    while (true) {
      const next = [...scheduled].filter(([, job]) => job.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      now = next[1].at; scheduled.delete(next[0]); next[1].fn(); await tick();
    }
    now = end; await tick();
  };
  f.error = message => listeners.error(message);
  f.rejection = reason => listeners.rejection({ reason });
  return f;
}

test('前台计时每60秒累计，离开停止，重新前台生成新会话且不包含后台时间', async () => {
  const f = clientFixture(); f.monitor.onShow(); await tick();
  const session = f.calls[0].sessionId;
  assert.deepEqual(f.calls[0], { action: 'trackUsage', eventType: 'start', sessionId: session, elapsedMs: 0, accountGeneration: 'epoch-a' });
  assert.equal(f.calls[1].eventId, session + ':start');
  await f.advance(60000); assert.equal(f.calls[2].elapsedMs, 60000);
  await f.advance(10000); f.monitor.onHide(); await tick();
  assert.equal(f.calls[3].eventType, 'end'); assert.equal(f.calls[3].elapsedMs, 70000);
  await f.advance(120000); assert.equal(f.calls.length, 4);
  f.monitor.onShow(); await tick(); assert.notEqual(f.calls[4].sessionId, session); assert.equal(f.calls[4].elapsedMs, 0);
  f.monitor.dispose(); assert.equal(f.scheduled.size, 0);
});

test('初次账户加载等待绑定，累计计时从绑定后的监控启动请求开始', async () => {
  const f = clientFixture(); f.scope(''); f.monitor.onShow(); await f.advance(12000);
  assert.equal(f.calls.length, 0);
  f.scope('account:epoch-a'); await tick(); assert.equal(f.calls.length, 2);
  await f.advance(1000); f.monitor.onHide(); await tick(); assert.equal(f.calls[2].elapsedMs, 1000);
  f.monitor.dispose();
});

test('启动回包等待计入前台时间，旧监控接口缺少服务端锚点时也不重置到ACK时刻', async () => {
  for (const legacy of [false, true]) {
    const f = clientFixture(); let acknowledge;
    f.respond = event => event.action === 'trackUsage' && event.eventType === 'start'
      ? new Promise(resolve => { acknowledge = () => resolve({ ok: true, ...(legacy ? {} : { data: {
        startedAtMs: Date.parse('2026-10-13T01:00:00Z'), observedAtMs: Date.parse('2026-10-13T01:00:00Z'), elapsedMs: 0
      } }) }); }) : { ok: true };
    f.monitor.onShow(); await tick(); await f.advance(12000); acknowledge(); await tick();
    await f.advance(1000); f.monitor.onHide(); await tick();
    assert.equal(f.calls.find(event => event.eventType === 'end').elapsedMs, 13000);
    f.monitor.dispose();
  }
});

test('服务端锚点字段无效或会话年龄超限时回退到请求发起时刻', async () => {
  const startedAtMs = Date.parse('2026-10-13T01:00:00Z');
  for (const data of [
    { startedAtMs, observedAtMs: startedAtMs + 5000, elapsedMs: '0' },
    { startedAtMs, observedAtMs: startedAtMs + 5000, elapsedMs: -1 },
    { startedAtMs, observedAtMs: startedAtMs + 36 * 60 * 60 * 1000 + 1, elapsedMs: 0 },
    { startedAtMs, observedAtMs: startedAtMs - 1, elapsedMs: 0 }
  ]) {
    const f = clientFixture();
    f.respond = () => ({ ok: true, data });
    f.monitor.onShow(); await tick(); await f.advance(1000); f.monitor.onHide(); await tick();
    assert.equal(f.calls.find(event => event.eventType === 'end').elapsedMs, 1000);
    f.monitor.dispose();
  }
});

test('启动两次失败后下一心跳恢复同一会话，后续前台时间继续上报', async () => {
  const f = clientFixture(); f.fail = true; f.monitor.onShow(); await tick(); await f.advance(1000);
  const originalSession = f.calls[0].sessionId;
  f.fail = false; await f.advance(59000);
  const starts = f.calls.filter(event => event.action === 'trackUsage' && event.eventType === 'start');
  assert.equal(starts.length, 3); assert.ok(starts.every(event => event.sessionId === originalSession));
  assert.equal(f.calls.find(event => event.eventType === 'heartbeat').elapsedMs, 0);
  await f.advance(10000); f.monitor.onHide(); await tick();
  assert.equal(f.calls.find(event => event.eventType === 'end').elapsedMs, 10000);
  f.monitor.dispose();
});

test('启动已入库但两次ACK丢失，跨午夜恢复使用原服务端锚点且不依赖本机绝对时钟', async () => {
  for (const initialNow of [0, Date.parse('2036-04-01T02:00:00Z')]) {
    const f = clientFixture({ initialNow });
    const serverStart = Date.parse('2026-10-12T23:59:55+08:00');
    let starts = 0, serverVisits = 0;
    f.respond = (event, observedLocal) => {
      if (event.action !== 'trackUsage' || event.eventType !== 'start') return { ok: true };
      if (++starts === 1) serverVisits += 1;
      if (starts <= 2) throw Error('lost acknowledgment');
      return { ok: true, data: { startedAtMs: serverStart, observedAtMs: serverStart + observedLocal - initialNow, elapsedMs: 0 } };
    };
    f.monitor.onShow(); await tick(); await f.advance(60000);
    const heartbeat = f.calls.find(event => event.eventType === 'heartbeat');
    assert.equal(serverVisits, 1); assert.equal(heartbeat.elapsedMs, 60000);
    assert.equal(new Date(serverStart + heartbeat.elapsedMs + 8 * 3600000).toISOString().slice(0, 10), '2026-10-13');
    await f.advance(10000); f.monitor.onHide(); await tick();
    assert.equal(f.calls.find(event => event.eventType === 'end').elapsedMs, 70000);
    f.monitor.dispose();
  }
});

test('后台期间启动ACK才返回时，末次时长只算到冻结的离开前台时刻', async () => {
  const f = clientFixture(); let acknowledge;
  f.respond = event => event.action === 'trackUsage' && event.eventType === 'start'
    ? new Promise(resolve => { acknowledge = () => resolve({ ok: true, data: {
      startedAtMs: Date.parse('2026-10-13T01:00:00Z'), observedAtMs: Date.parse('2026-10-13T01:00:00Z'), elapsedMs: 0
    } }); }) : { ok: true };
  f.monitor.onShow(); await tick(); await f.advance(5000); f.monitor.onHide();
  await f.advance(20000); acknowledge(); await tick();
  assert.equal(f.calls.find(event => event.eventType === 'end').elapsedMs, 5000);
  assert.equal(f.calls.filter(event => event.eventType === 'heartbeat').length, 0);
  f.monitor.dispose();
});

test('下一心跳前离开前台也可重试未确认启动，复用会话并上报冻结结束时长', async () => {
  const f = clientFixture(); let attempts = 0;
  const serverStart = Date.parse('2026-10-13T01:00:00Z');
  f.respond = (event, observedLocal) => {
    if (event.action !== 'trackUsage' || event.eventType !== 'start') return { ok: true };
    if (++attempts <= 2) throw Error('lost acknowledgment');
    return { ok: true, data: { startedAtMs: serverStart, observedAtMs: serverStart + observedLocal, elapsedMs: 0 } };
  };
  f.monitor.onShow(); await tick(); await f.advance(1000); await f.advance(4000); f.monitor.onHide(); await tick();
  const starts = f.calls.filter(event => event.action === 'trackUsage' && event.eventType === 'start');
  assert.equal(starts.length, 3); assert.ok(starts.every(event => event.sessionId === starts[0].sessionId));
  assert.equal(f.calls.find(event => event.eventType === 'end').elapsedMs, 5000);
  f.monitor.dispose();
});

test('上报只在内存重试一次且保留eventId，账户代际改变丢弃旧重试', async () => {
  const f = clientFixture(); f.fail = true; f.monitor.onShow(); await tick();
  await f.advance(1000); assert.equal(f.calls.length, 4); await f.advance(1000); assert.equal(f.calls.length, 4);
  f.fail = false; f.monitor.onHide(); await tick(); f.fail = true; f.monitor.onShow(); await tick();
  const oldId = f.calls[f.calls.length - 1].eventId;
  f.scope('account:epoch-b'); await tick(); const count = f.calls.length;
  await f.advance(1000);
  assert.equal(f.calls.filter(call => call.eventId === oldId).length, 1);
  assert.equal(f.calls.length, count + 2); // Only the new account's start and app_start retries.
  f.monitor.dispose();
});

test('运行错误与拒绝只发送固定code，监控云调用不会递归采集性能', async () => {
  const f = clientFixture(); f.monitor.onShow(); await tick();
  f.error('private title and note'); f.rejection(Error('private title and note')); await tick();
  assert.equal(f.calls[2].payload.code, 'APP_ERROR'); assert.equal(f.calls[3].payload.code, 'UNHANDLED_REJECTION');
  assert.doesNotMatch(JSON.stringify(f.calls), /private|title|note|reason|message|stack/);
  const sdk = { cloud: { init() {}, async callFunction() { return { result: { ok: true } }; } } };
  // The observer belongs to f.wxApi; install the SDK on that object.
  f.wxApi.cloud = sdk.cloud;
  await createCloudTransport(f.wxApi, { enabled: true, envId: 'env-test', functionName: 'jiancheng_daka_api' })({ action: 'pull' });
  await tick(); assert.equal(f.calls[4].type, 'performance'); assert.equal(f.calls[4].payload.functionName, 'jiancheng_daka_api');
  const count = f.calls.length;
  await createCloudTransport(f.wxApi, { enabled: true, envId: 'env-test', functionName: 'monitorApi' })({ action: 'trackUsage' });
  await tick(); assert.equal(f.calls.length, count); f.monitor.dispose();
});

function serverFixture({ reporterFails = false, reporter } = {}) {
  let saved = null, serial = 0;
  const events = [], logs = [];
  const f = { events, logs, date: '2026-10-11', failWrite: false };
  const identity = { APPID: 'resource', OPENID: 'resource_user', FROM_APPID: 'wx58e61dffcbfa4249', FROM_OPENID: 'trusted_user', SOURCE: 'wx_client' };
  const api = createApi({ domain, dates, allowedAppId: identity.FROM_APPID, allowedSources: ['wx_client'],
    clock: () => new Date(f.date + 'T01:02:03.000Z'), newEpoch: () => 'epoch-test',
    repository: { async transact(owner, operation) {
      const count = events.length, outcome = await operation(copy(saved));
      assert.equal(events.length, count, 'monitor is never called inside the business transaction');
      if (f.failWrite) throw Error('private database error');
      saved = copy(outcome.account); return copy(outcome.result);
    } },
    reportOperations: reporter || (async (event, caller, now) => { if (reporterFails) throw Error('private monitor error'); events.push({ ...copy(event), caller, now }); }),
    monitorLogger: code => logs.push(code)
  });
  f.api = event => api(event, identity);
  f.pull = () => f.api({ action: 'pull' });
  f.request = (snapshot, command, extras = {}) => ({ action: 'mutate', operationId: 'op_' + (++serial), epoch: snapshot.epoch,
    expectedRevision: snapshot.revision, operationDate: f.date, command, sessionId: 'foreground_session', ...extras });
  f.mutate = async command => f.api(f.request(await f.pull(), command));
  f.seed = () => f.mutate({ type: 'create', id: 'habit_read', plan: plan() });
  return f;
}

test('习惯创建和完成状态转换只在主事务成功后计数，重放和无变化不计数', async () => {
  const f = serverFixture(), seeded = await f.seed();
  assert.equal(f.events[0].type, 'habit_created'); assert.deepEqual(f.events[0].payload, { sessionId: 'foreground_session' });
  const request = f.request(seeded, { type: 'complete', id: 'habit_read', date: f.date });
  assert.equal((await f.api(request)).ok, true); assert.equal(f.events[1].type, 'checkin_completed');
  assert.deepEqual(f.events[1].payload, { recordDate: f.date, status: 'standard', sessionId: 'foreground_session' });
  assert.equal((await f.api(request)).replayed, true); assert.equal(f.events.length, 2);
  await f.mutate({ type: 'complete', id: 'habit_read', date: f.date });
  await f.mutate({ type: 'create', id: 'habit_read', plan: plan() });
  await f.mutate({ type: 'note', id: 'habit_read', date: f.date, note: 'private note' });
  assert.equal(f.events.length, 2);
  await f.mutate({ type: 'undo', id: 'habit_read', date: f.date });
  await f.mutate({ type: 'completeMinimum', id: 'habit_read', date: f.date });
  assert.equal(f.events.length, 3); assert.equal(f.events[2].payload.status, 'minimum');
  assert.doesNotMatch(JSON.stringify(f.events.map(e => ({ ...e, caller: undefined }))), /private note|读一会儿/);
});

test('失败、冲突和监控故障不产生业务假成功或改变已提交回执', async () => {
  const f = serverFixture(), initial = await f.seed(), count = f.events.length;
  f.failWrite = true;
  assert.equal((await f.api(f.request(initial, { type: 'complete', id: 'habit_read', date: f.date }))).code, 'SERVICE_UNAVAILABLE');
  assert.equal(f.events.length, count); f.failWrite = false;
  assert.equal((await f.api(f.request(initial, { type: 'complete', id: 'unknown', date: f.date }))).code, 'INVALID_COMMAND');
  assert.equal((await f.api(f.request(initial, { type: 'complete', id: 'habit_read', date: f.date }, { expectedRevision: 99 }))).code, 'CONFLICT');
  assert.equal(f.events.length, count);
  const broken = serverFixture({ reporterFails: true }); assert.equal((await broken.seed()).ok, true);
  assert.deepEqual(broken.logs, ['MONITOR_WRITE_FAILED']); assert.equal((await broken.pull()).state.habits.length, 1);
});

test('监控写入卡住时500ms内结束等待，已保存习惯仍确认且迟到拒绝不影响重试', async () => {
  let reject;
  const pending = new Promise((_resolve, fail) => { reject = fail; });
  const f = serverFixture({ reporter: () => pending });
  const result = await Promise.race([f.seed(), new Promise((_resolve, fail) => {
    const timer = setTimeout(() => fail(Error('business receipt blocked')), 1500); timer.unref();
  })]);
  assert.equal(result.ok, true); assert.equal(result.state.habits.length, 1);
  assert.deepEqual(f.logs, ['MONITOR_WRITE_TIMEOUT']);
  reject(Error('late private failure')); await tick();
  assert.equal((await f.pull()).state.habits.length, 1); assert.deepEqual(f.logs, ['MONITOR_WRITE_TIMEOUT']);
});

test('重新进入前台会取消上一次会话的待重试请求', async () => {
  const f = clientFixture(); f.fail = true; f.monitor.onShow(); await tick();
  const old = f.calls[0].sessionId;
  f.monitor.onHide(); f.monitor.onShow(); await tick(); await f.advance(1000);
  assert.equal(f.calls.filter(event => event.sessionId === old && event.action === 'trackUsage').length, 1);
  assert.equal(f.calls.filter(event => event.payload && event.payload.sessionId === old).length, 1);
  f.monitor.dispose();
});

test('服务端运营写入按可信来源身份派生ID且只保存白名单与Date时间', async () => {
  const docs = new Map();
  const db = monitorDatabase();
  const reporter = createOperationsReporter(db);
  const identity = { APPID: 'resource', OPENID: 'private_resource_id', FROM_APPID: 'wx58e61dffcbfa4249', FROM_OPENID: 'trusted_user' };
  const owner = crypto.createHash('sha256').update('wx58e61dffcbfa4249:trusted_user').digest('hex');
  db.rows.set('jiancheng_daka_accounts:' + owner, { payload: { epoch: 'epoch-a' } });
  const metric = { eventId: 'stable-event', type: 'habit_created', accountGeneration: 'epoch-a', payload: {} }, now = new Date('2026-10-11T01:02:03Z');
  await reporter(metric, identity, now); await reporter(metric, identity, now);
  const recorded = [...db.rows].filter(([key]) => key.startsWith('monitor_events:'));
  assert.equal(recorded.length, 1); const row = recorded[0][1];
  assert.equal(row.sourceUserId, 'user_' + crypto.createHash('sha256').update('wx58e61dffcbfa4249|trusted_user').digest('hex').slice(0, 24));
  assert.equal(row.appId, 'jiancheng'); assert.ok(row.createdAt instanceof Date); assert.ok(row.occurredAt instanceof Date);
  assert.doesNotMatch(JSON.stringify(row), /trusted_user|private_resource_id/);
  await assert.rejects(() => reporter(metric, { ...identity, FROM_APPID: 'another_app' }, now));
});

function monitorDatabase({ singleInflight = false } = {}) {
  const rows = new Map();
  const db = { rows, command: { inc: value => ({ increment: value }) }, failRemove: false, collection(name) { return {
    doc(id) { return {
      async get() { return { data: rows.get(name + ':' + id) || null }; },
      async set({ data }) { rows.set(name + ':' + id, data); },
      async update({ data }) { const doc = rows.get(name + ':' + id); doc._monitorFence = (doc._monitorFence || 0) + data._monitorFence.increment; },
      async remove() { if (db.failRemove) throw Error('private-remove-error'); rows.delete(name + ':' + id); }
    }; },
    where(query) { return { limit(count) { return { async get() { return { data: [...rows].filter(([key, row]) => key.startsWith(name + ':') && Object.entries(query).every(([field, value]) => row[field] === value)).slice(0, count).map(([key, row]) => ({ ...row, _id: key.slice(name.length + 1) })) }; } }; } }; }
  }; }, async runTransaction(work) {
    if (db.beforeTransaction) await db.beforeTransaction();
    if (!singleInflight) return work(db);
    let busy = false;
    return work({ collection(name) { return { doc(id) {
      const reference = db.collection(name).doc(id);
      return Object.fromEntries(['get', 'set', 'update', 'remove'].map(method => [method, async (...args) => {
        if (busy) throw Error('ResourceUnavailable.TransactionBusy');
        busy = true;
        try { await new Promise(resolve => setImmediate(resolve)); return await reference[method](...args); }
        finally { busy = false; }
      }]));
    } }; } });
  } };
  return db;
}

test('业务事件和多文档遥测清理在同一事务内逐项等待，保留幂等、栅栏及个人范围', async () => {
  const db = monitorDatabase({ singleInflight: true });
  const identity = { APPID: 'wx58e61dffcbfa4249', OPENID: 'trusted_user', SOURCE: 'wx_client' };
  const owner = crypto.createHash('sha256').update(identity.APPID + ':' + identity.OPENID).digest('hex');
  const userId = 'user_' + crypto.createHash('sha256').update(identity.APPID + '|' + identity.OPENID).digest('hex').slice(0, 24);
  const account = { payload: { epoch: 'epoch-a' }, _monitorFence: 3 };
  db.rows.set('jiancheng_daka_accounts:' + owner, account);
  const reporter = createOperationsReporter(db);
  const metric = { type: 'habit_created', eventId: 'sequential-event', accountGeneration: 'epoch-a', payload: {} };
  assert.equal(await reporter(metric, identity, new Date('2026-10-13T01:00:00Z')), true);
  assert.equal(await reporter(metric, identity, new Date('2026-10-13T01:00:01Z')), false);
  assert.equal(account._monitorFence, 4);
  Object.assign(account.payload, { epoch: 'epoch-b', cleanupPending: true, cleanupSourceEpoch: 'epoch-a' });
  for (const [name, field] of [['monitor_users', 'userId'], ['monitor_usage_daily', 'userId'], ['monitor_usage_sessions', 'userId'], ['monitor_events', 'sourceUserId']]) {
    for (let index = 0; index < 3; index++) db.rows.set(name + ':own-' + index, { appId: 'jiancheng', [field]: userId });
    db.rows.set(name + ':other-user', { appId: 'jiancheng', [field]: 'user_other' });
    db.rows.set(name + ':other-app', { appId: 'linggan', [field]: userId });
  }
  await createOperationsCleanup(db)(owner, 'epoch-a', identity);
  for (const name of ['monitor_users', 'monitor_usage_daily', 'monitor_usage_sessions', 'monitor_events']) {
    assert.equal([...db.rows.keys()].filter(key => key.startsWith(name + ':')).length, 2);
    assert.equal(db.rows.has(name + ':other-user'), true);
    assert.equal(db.rows.has(name + ':other-app'), true);
  }
  assert.ok(account._monitorFence > 4);
});

test('未创建运营集合时删除全部数据仍成功，权限错误和模糊缺失错误继续待处理', async () => {
  for (const code of [-502005, 'DATABASE_COLLECTION_NOT_EXIST', 'PERMISSION_DENIED', 'UNKNOWN']) {
    const db = monitorDatabase(); let epoch = 0;
    const identity = { APPID: 'wx58e61dffcbfa4249', OPENID: 'trusted_user', SOURCE: 'wx_client' };
    const collection = db.collection.bind(db);
    db.collection = name => {
      const ref = collection(name);
      if (name.startsWith('monitor_')) ref.where = () => ({ limit: () => ({ get: async () => {
        const error = Error('collection not exist or permission denied'); error.errCode = code; throw error;
      } }) });
      return ref;
    };
    const handle = createApi({ domain, dates, allowedAppId: identity.APPID, allowedSources: ['wx_client'],
      clock: () => new Date('2026-10-11T01:02:03Z'), newEpoch: () => 'epoch_' + (++epoch), cleanup: createOperationsCleanup(db),
      repository: { async transact(scope, work) {
        const outcome = await work(copy(db.rows.get('jiancheng_daka_accounts:' + scope)?.payload || null));
        db.rows.set('jiancheng_daka_accounts:' + scope, { payload: copy(outcome.account) }); return outcome.result;
      } } });
    const initial = await handle({ action: 'pull' }, identity);
    const result = await handle({ action: 'purge', operationId: 'purge-no-monitor', epoch: initial.epoch, expectedRevision: initial.revision,
      operationDate: '2026-10-11', confirmation: 'DELETE_MY_DATA' }, identity);
    if ([-502005, 'DATABASE_COLLECTION_NOT_EXIST'].includes(code)) {
      assert.equal(result.ok, true); assert.deepEqual(result.state, domain.emptyState());
      assert.equal((await handle({ action: 'pull' }, identity)).ok, true);
    } else { assert.equal(result.code, 'DELETE_PENDING'); assert.equal((await handle({ action: 'pull' }, identity)).code, 'DELETE_PENDING'); }
  }
});

test('删除代际屏障阻止迟到业务监控复活记录，只清理本应用本用户的遥测', async () => {
  const db = monitorDatabase();
  const identity = { APPID: 'wx58e61dffcbfa4249', OPENID: 'trusted_user', SOURCE: 'wx_client' };
  const owner = crypto.createHash('sha256').update(identity.APPID + ':' + identity.OPENID).digest('hex');
  const userId = 'user_' + crypto.createHash('sha256').update(identity.APPID + '|' + identity.OPENID).digest('hex').slice(0, 24);
  db.rows.set('jiancheng_daka_accounts:' + owner, { payload: { epoch: 'new-epoch', cleanupPending: true, cleanupSourceEpoch: 'old-epoch' } });
  for (const [name, field] of [['monitor_users', 'userId'], ['monitor_usage_daily', 'userId'], ['monitor_usage_sessions', 'userId'], ['monitor_events', 'sourceUserId']]) {
    db.rows.set(name + ':own', { appId: 'jiancheng', [field]: userId });
    db.rows.set(name + ':other-user', { appId: 'jiancheng', [field]: 'user_other' });
    db.rows.set(name + ':other-app', { appId: 'linggan', [field]: userId });
  }
  const cleanup = createOperationsCleanup(db);
  await cleanup(owner, 'old-epoch', identity);
  for (const name of ['monitor_users', 'monitor_usage_daily', 'monitor_usage_sessions', 'monitor_events']) {
    assert.equal(db.rows.has(name + ':own'), false); assert.equal(db.rows.has(name + ':other-user'), true); assert.equal(db.rows.has(name + ':other-app'), true);
  }
  const reporter = createOperationsReporter(db);
  await reporter({ type: 'habit_created', eventId: 'late-event', accountGeneration: 'old-epoch', payload: {} }, identity, new Date());
  assert.equal([...db.rows].filter(([key]) => key.startsWith('monitor_events:')).length, 2);
  db.rows.set('jiancheng_daka_accounts:' + owner, { payload: { epoch: 'new-epoch' } });
  await reporter({ type: 'habit_created', eventId: 'late-event-2', accountGeneration: 'old-epoch', payload: {} }, identity, new Date());
  assert.equal([...db.rows].filter(([key]) => key.startsWith('monitor_events:')).length, 2);
  await assert.rejects(() => cleanup(owner, 'old-epoch', identity), /NOT_PENDING/);
});

test('遥测清理失败保持DELETE_PENDING，下次pull继续清理后才返回成功', async () => {
  const db = monitorDatabase(); let epoch = 0;
  const identity = { APPID: 'wx58e61dffcbfa4249', OPENID: 'trusted_user', SOURCE: 'wx_client' };
  const owner = crypto.createHash('sha256').update(identity.APPID + ':' + identity.OPENID).digest('hex');
  const userId = 'user_' + crypto.createHash('sha256').update(identity.APPID + '|' + identity.OPENID).digest('hex').slice(0, 24);
  const handle = createApi({ domain, dates, allowedAppId: identity.APPID, allowedSources: ['wx_client'],
    clock: () => new Date('2026-10-11T01:02:03Z'), newEpoch: () => 'epoch_' + (++epoch), cleanup: createOperationsCleanup(db),
    repository: { async transact(scope, work) {
      const outcome = await work(copy(db.rows.get('jiancheng_daka_accounts:' + scope)?.payload || null));
      db.rows.set('jiancheng_daka_accounts:' + scope, { payload: copy(outcome.account) }); return outcome.result;
    } } });
  const initial = await handle({ action: 'pull' }, identity);
  db.rows.set('monitor_events:own', { appId: 'jiancheng', sourceUserId: userId }); db.failRemove = true;
  const result = await handle({ action: 'purge', operationId: 'purge-monitor', epoch: initial.epoch, expectedRevision: initial.revision,
    operationDate: '2026-10-11', confirmation: 'DELETE_MY_DATA' }, identity);
  assert.equal(result.code, 'DELETE_PENDING'); assert.equal(db.rows.get('jiancheng_daka_accounts:' + owner).payload.cleanupPending, true);
  db.failRemove = false;
  const restored = await handle({ action: 'pull' }, identity);
  assert.equal(restored.ok, true); assert.equal(db.rows.has('monitor_events:own'), false);
  assert.equal(db.rows.get('jiancheng_daka_accounts:' + owner).payload.cleanupPending, undefined);
});

test('并行旧清理在另一路完成并开始新代际后不会删除新使用记录', async () => {
  const db = monitorDatabase();
  const identity = { APPID: 'wx58e61dffcbfa4249', OPENID: 'trusted_user', SOURCE: 'wx_client' };
  const owner = crypto.createHash('sha256').update(identity.APPID + ':' + identity.OPENID).digest('hex');
  const userId = 'user_' + crypto.createHash('sha256').update(identity.APPID + '|' + identity.OPENID).digest('hex').slice(0, 24);
  db.rows.set('jiancheng_daka_accounts:' + owner, { payload: { epoch: 'new-epoch', cleanupPending: true, cleanupSourceEpoch: 'old-epoch' } });
  db.rows.set('monitor_users:own', { appId: 'jiancheng', userId, accountGeneration: 'old-epoch' });
  db.beforeTransaction = async () => {
    db.beforeTransaction = null;
    db.rows.set('jiancheng_daka_accounts:' + owner, { payload: { epoch: 'new-epoch' } });
    db.rows.set('monitor_users:own', { appId: 'jiancheng', userId, accountGeneration: 'new-epoch' });
  };
  await createOperationsCleanup(db)(owner, 'old-epoch', identity);
  assert.equal(db.rows.get('monitor_users:own').accountGeneration, 'new-epoch');
});

test('业务结果未知后的重试保持原sessionId，不随新的前台会话变化', async () => {
  const f = serverFixture(); let sessionId = 'session_old', lose = true;
  const requests = [];
  const session = createCloudSession({}, { enabled: true, envId: 'fixture' }, () => async event => {
    requests.push(copy(event));
    const response = await f.api(event);
    if (event.action === 'mutate' && lose) { lose = false; throw Error('lost acknowledgment'); }
    return response;
  }, { now: () => Date.parse(f.date + 'T01:02:03Z'), newId: () => 'fixed_operation', sessionId: () => sessionId });
  await session.start();
  await assert.rejects(() => session.dispatch({ type: 'create', id: 'habit_read', plan: plan() }));
  sessionId = 'session_new'; await session.retry();
  const mutations = requests.filter(request => request.action === 'mutate');
  assert.equal(mutations.length, 2); assert.deepEqual(mutations[0], mutations[1]); assert.equal(mutations[1].sessionId, 'session_old');
  assert.equal(f.events.length, 1);
});

test('旧云函数未声明统计字段能力时新客户端不发送sessionId，保存打卡与撤销仍成功', async () => {
  const f = serverFixture(), sent = [];
  const session = createCloudSession({}, { enabled: true, envId: 'test-env' }, () => async event => {
    sent.push(copy(event)); assert.equal(Object.hasOwn(event, 'sessionId'), false, 'legacy strict protocol accepts the original envelope');
    const result = await f.api(event); delete result.capabilities; return result;
  }, { now: () => Date.parse(f.date + 'T01:02:03Z'), sessionId: () => 'session_new' });
  await session.start();
  await session.dispatch({ type: 'create', id: 'habit_read', plan: plan() });
  await session.dispatch({ type: 'complete', id: 'habit_read', date: f.date });
  assert.equal(session.read().records['habit_read@' + f.date].status, 'standard');
  await session.dispatch({ type: 'undo', id: 'habit_read', date: f.date });
  assert.equal(session.read().records['habit_read@' + f.date].status, 'pending');
  assert.equal(sent.filter(event => event.action === 'mutate').length, 3);
});

test('sessionId只允许操作元数据，不允许读取或伪造正文身份', async () => {
  const f = serverFixture();
  assert.equal((await f.api({ action: 'pull', sessionId: 'abc' })).code, 'INVALID_REQUEST');
  const initial = await f.pull();
  assert.equal((await f.api(f.request(initial, { type: 'create', id: 'habit_read', plan: plan() }, { sessionId: 'private title' }))).code, 'INVALID_REQUEST');
  assert.equal((await f.api(f.request(initial, { type: 'create', id: 'habit_read', plan: plan() }, { sourceUserId: 'victim' }))).code, 'INVALID_REQUEST');
  assert.equal(f.events.length, 0);
});

// Snapshot isolation: only documents in the write set cause conflicts. Reads
// deliberately do not lock or validate versions; each retry gets a fresh copy.
function mvccDatabase() {
  const rows = new Map(), versions = new Map();
  const f = { rows, attempts: 0, conflicts: 0, beforeFirstWrite: null,
    put(key, doc) { rows.set(key, structuredClone(doc)); versions.set(key, (versions.get(key) || 0) + 1); } };
  function references(state) {
    return name => ({
      doc(id) {
        const key = name + ':' + id;
        async function write(doc) {
          if (!state) { f.put(key, doc); return; }
          if (!state.writes.size && f.beforeFirstWrite) {
            const hook = f.beforeFirstWrite; f.beforeFirstWrite = null; await hook();
          }
          state.writing = true; state.writes.set(key, doc === null ? null : structuredClone(doc));
        }
        return {
          async get() {
            if (state && state.writing) throw Error('READ_AFTER_WRITE');
            if (state && !state.snapshot) { state.snapshot = structuredClone(rows); state.versions = new Map(versions); }
            return { data: structuredClone((state ? state.snapshot : rows).get(key) || null) };
          },
          async set({ data }) { await write(data); },
          async update({ data }) {
            const doc = structuredClone(state.snapshot.get(key));
            assert.ok(doc, 'update requires an existing account');
            assert.deepEqual(Object.keys(data), ['_monitorFence']);
            doc._monitorFence = (doc._monitorFence || 0) + data._monitorFence.increment;
            await write(doc);
          },
          async remove() { await write(null); }
        };
      },
      where(query) { return { limit(count) { return { async get() {
        return { data: [...rows].filter(([key, doc]) => key.startsWith(name + ':') && Object.entries(query).every(([field, value]) => doc[field] === value))
          .slice(0, count).map(([key, doc]) => ({ ...structuredClone(doc), _id: key.slice(name.length + 1) })) };
      } }; } }; }
    });
  }
  f.db = { command: { inc: increment => ({ increment }) }, collection: references(null), async runTransaction(work) {
    for (let attempt = 0; attempt < 3; attempt++) {
      f.attempts += 1;
      const state = { snapshot: null, versions: null, writes: new Map(), writing: false };
      const result = await work({ collection: references(state) });
      if ([...state.writes.keys()].some(key => (versions.get(key) || 0) !== (state.versions.get(key) || 0))) { f.conflicts += 1; continue; }
      for (const [key, doc] of state.writes) {
        if (doc === null) { rows.delete(key); versions.set(key, (versions.get(key) || 0) + 1); }
        else f.put(key, doc);
      }
      return result;
    }
    throw Error('DATABASE_TRANSACTION_CONFLICT');
  } };
  return f;
}

const monitorCaller = { APPID: 'wx58e61dffcbfa4249', OPENID: 'trusted_user', SOURCE: 'wx_client' };
const monitorOwner = crypto.createHash('sha256').update(monitorCaller.APPID + ':' + monitorCaller.OPENID).digest('hex');
const monitorUser = 'user_' + crypto.createHash('sha256').update(monitorCaller.APPID + '|' + monitorCaller.OPENID).digest('hex').slice(0, 24);

test('MVCC负对照：只读账户不会与并发purge产生冲突', async () => {
  const f = mvccDatabase(), key = 'jiancheng_daka_accounts:' + monitorOwner;
  f.put(key, { payload: { epoch: 'old-epoch' } });
  f.beforeFirstWrite = async () => f.put(key, { payload: { epoch: 'new-epoch', cleanupPending: true } });
  await f.db.runTransaction(async tx => {
    const account = await tx.collection('jiancheng_daka_accounts').doc(monitorOwner).get();
    assert.equal(account.data.payload.epoch, 'old-epoch');
    await tx.collection('monitor_events').doc('unfenced-event').set({ data: { appId: 'jiancheng' } });
  });
  assert.equal(f.conflicts, 0); assert.equal(f.rows.has('monitor_events:unfenced-event'), true);
});

test('MVCC旧业务事件读取后purge：栅栏写冲突后重读拒绝旧事件', async () => {
  const f = mvccDatabase(), key = 'jiancheng_daka_accounts:' + monitorOwner;
  f.put(key, { payload: { epoch: 'old-epoch' }, _monitorFence: 3 });
  f.beforeFirstWrite = async () => f.put(key, { payload: { epoch: 'new-epoch', cleanupPending: true }, _monitorFence: 3 });
  await createOperationsReporter(f.db)({ type: 'habit_created', eventId: 'old-event', accountGeneration: 'old-epoch', payload: {} }, monitorCaller, new Date());
  assert.equal(f.conflicts, 1); assert.equal(f.attempts, 2);
  assert.equal([...f.rows.keys()].some(key => key.startsWith('monitor_events:')), false);
  assert.equal(f.rows.get(key).payload.epoch, 'new-epoch'); assert.equal(f.rows.get(key)._monitorFence, 3);
});

test('MVCC旧清理读取后新代际使用：重试退出并保留新用户记录', async () => {
  const f = mvccDatabase(), key = 'jiancheng_daka_accounts:' + monitorOwner;
  f.put(key, { payload: { epoch: 'new-epoch', cleanupPending: true, cleanupSourceEpoch: 'old-epoch' }, _monitorFence: 3 });
  f.put('monitor_users:own', { appId: 'jiancheng', userId: monitorUser, accountGeneration: 'old-epoch' });
  f.beforeFirstWrite = async () => {
    f.put(key, { payload: { epoch: 'new-epoch' }, _monitorFence: 4 });
    f.put('monitor_users:own', { appId: 'jiancheng', userId: monitorUser, accountGeneration: 'new-epoch' });
  };
  await createOperationsCleanup(f.db)(monitorOwner, 'old-epoch', monitorCaller);
  assert.equal(f.conflicts, 1); assert.equal(f.attempts, 2);
  assert.equal(f.rows.get('monitor_users:own').accountGeneration, 'new-epoch'); assert.equal(f.rows.get(key)._monitorFence, 4);
});

test('主账户业务写入保留顶层栅栏，内部计数不进入业务payload或返回状态', async () => {
  const f = mvccDatabase(), key = 'jiancheng_daka_accounts:' + monitorOwner;
  const account = { epoch: 'epoch-a', revision: 0, receipts: [], state: domain.emptyState() };
  f.put(key, { payload: account, _monitorFence: 9 });
  const result = await createRepository(f.db).transact(monitorOwner, async saved => ({ account: { ...saved, revision: 1 }, result: { ok: true, revision: 1 } }));
  assert.deepEqual(result, { ok: true, revision: 1 }); assert.equal(f.rows.get(key)._monitorFence, 9);
  assert.equal(f.rows.get(key).payload._monitorFence, undefined);
});
