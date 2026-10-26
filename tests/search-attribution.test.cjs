const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createSearchAttribution, entry } = require('../miniprogram/services/search-attribution');
const { createAppLifecycle } = require('../miniprogram/services/app-lifecycle');
const { createCloudSession } = require('../miniprogram/services/cloud-session');
const { createApi } = require('../server/handler');
const { createOperationsReporter } = require('../server/operations-monitor');
const { domain, dates, plan, copy } = require('./helpers/cloud-fixture.cjs');
const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const source = (overrides = {}) => ({ visitId: 'visit_a', scene: 1005, route: 'pages/template/index', templateKey: 'read', ...overrides });

function attributionFixture(initial = {}) {
  const status = { ready: false, accountId: '', epoch: '', ...initial }, listeners = new Set(), calls = [];
  let serial = 0;
  const f = { status, calls, record: null };
  f.service = createSearchAttribution({ newId: () => 'visit_' + (++serial), session: {
    status: () => ({ ...status }), subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    async trackDiscovery(kind, value) { calls.push({ kind, source: copy(value) }); return f.record ? f.record() : true; }
  } });
  f.set = values => { Object.assign(status, values); listeners.forEach(listener => listener()); };
  return f;
}

test('公开来源只保留场景和白名单字段，冷启显示去重，账户就绪前不发送', async () => {
  const f = attributionFixture();
  const options = { path: 'pages/template/index', scene: 1005, query: { key: 'read', query: 'private query', openid: 'private owner' }, referrerInfo: { extraData: 'private referrer' } };
  f.service.onLaunch(options); f.service.onShow(options);
  f.service.viewPage({ route: 'pages/template/index', templateKey: 'read' });
  f.service.viewPage({ route: 'pages/template/index', templateKey: 'read' });
  f.service.chooseTemplate('read'); f.service.chooseTemplate('read');
  assert.equal(f.calls.length, 0); assert.equal(f.service.capture(), null);
  f.set({ ready: true, accountId: 'account_a', epoch: 'epoch_a' }); await tick();
  assert.equal(f.calls.length, 3); assert.equal(f.calls[0].kind, 'entry'); assert.equal(f.calls[0].source.visitId, 'visit_1');
  assert.deepEqual(f.service.capture(), source({ visitId: 'visit_1' }));
  assert.doesNotMatch(JSON.stringify(f.calls), /private|query|openid|referrer/);
  assert.deepEqual(entry({ path: 'pages/edit/index?secret=yes', scene: '1005', query: { key: 'read' } }), { scene: 0, route: '', templateKey: '' });
  f.service.dispose();
});

test('热重入使用新来源，1129爬虫与非法模板不产生统计', async () => {
  const f = attributionFixture({ ready: true, accountId: 'account_a', epoch: 'epoch_a' });
  f.service.onLaunch({ scene: 1005, path: 'pages/discover/index' }); f.service.onShow({});
  f.service.viewPage({ route: 'pages/discover/index' }); await tick();
  f.service.onShow({ scene: 1006, path: 'pages/template/index', query: { key: 'walk' } });
  f.service.viewPage({ route: 'pages/template/index', templateKey: 'walk' }); await tick();
  assert.equal(f.calls.length, 4); assert.equal(f.calls[2].source.visitId, 'visit_2'); assert.equal(f.calls[2].source.scene, 1006);
  f.service.onShow({ scene: 1129, path: 'pages/discover/index' });
  f.service.viewPage({ route: 'pages/discover/index' }); f.service.chooseTemplate('read'); await tick();
  assert.equal(f.calls.length, 4); assert.equal(f.service.capture(), null); assert.equal(f.service.isCrawler(), true);
  f.service.onShow({ scene: 1005, path: 'pages/template/index', query: { key: 'private words' } });
  f.service.viewPage({ route: 'pages/template/index', templateKey: 'private words' }); f.service.chooseTemplate('private words');
  assert.equal(f.service.capture(), null); assert.equal(f.calls.length, 4);
  f.service.onShow({ scene: 1001, path: 'pages/today/index' });
  assert.deepEqual(f.service.capture(), { visitId: 'visit_5', scene: 1001, route: 'pages/today/index' });
  f.service.onShow({ scene: 1005, path: 'pages/detail/index', query: { id: 'private habit' } });
  assert.equal(f.service.capture(), null, 'unknown private routes are never rewritten as Today');
  f.service.dispose();
});

test('账户epoch变化、删除中及迟到发送丢弃旧来源，不为新账户补发', async () => {
  const f = attributionFixture({ ready: true, accountId: 'account_a', epoch: 'epoch_a' });
  let resolve;
  f.record = () => new Promise(done => { resolve = done; });
  f.service.onLaunch({ scene: 1005, path: 'pages/discover/index' }); f.service.onShow({});
  f.service.viewPage({ route: 'pages/discover/index' }); f.service.chooseTemplate('read'); await tick();
  assert.equal(f.calls.length, 1);
  f.set({ epoch: 'epoch_b' }); resolve(); await tick();
  assert.equal(f.calls.length, 1); assert.equal(f.service.capture(), null);
  f.set({ deletionPending: true }); f.service.onShow({ scene: 1005, path: 'pages/discover/index' });
  f.service.viewPage({ route: 'pages/discover/index' });
  assert.equal(f.service.capture(), null); assert.equal(f.calls.length, 1);
  f.service.dispose();
});

test('发送结束的微任务间隙加入的新页面仍会发送，不依赖后续订阅唤醒', async () => {
  const f = attributionFixture({ ready: true, accountId: 'account_a', epoch: 'epoch_a' });
  f.service.onLaunch({ path: 'pages/discover/index', scene: 1005 }); f.service.onShow({}); await tick();
  f.service.viewPage({ route: 'pages/template/index', templateKey: 'read' });
  await Promise.resolve().then(() => f.service.viewPage({ route: 'pages/template/index', templateKey: 'walk' }));
  await tick();
  assert.deepEqual(f.calls.filter(call => call.kind === 'public_view').map(call => call.source.templateKey), ['read', 'walk']);
  f.service.dispose();
});

test('公共生命周期不准备云或读取账户，所有私有入口共用一次初始化', async () => {
  let starts = 0, prepares = 0, foregrounds = 0, recovery;
  const session = { status: () => ({ configured: true, phase: 'loading' }), subscribe: () => () => {},
    async start() { starts++; return { phase: 'ready' }; }, async onForeground() { foregrounds++; return { phase: 'ready' }; },
    setNetworkAvailable() {}, recoverConnection() { throw Error('public page must not recover account'); } };
  const lifecycle = createAppLifecycle({ wxApi: { onNetworkStatusChange(listener) { recovery = listener; } }, cloudConfig: {},
    createCloudSession: () => session, createWorkspaceStore: () => ({}), createQuoteSession: () => ({}), prepareCloudConnection() { prepares++; } });
  const app = {}, options = { scene: 1005, path: 'pages/discover/index' };
  await lifecycle.onLaunch(app, options); await lifecycle.onShow(app, options);
  recovery({ isConnected: true }); assert.equal(starts, 0); assert.equal(prepares, 0); assert.equal(foregrounds, 0);
  const first = app.ensureAccountReady(), second = app.ensureAccountReady();
  assert.equal(first, second); await first;
  assert.equal(starts, 1); assert.equal(prepares, 1);
  lifecycle.onHide(app); await lifecycle.onShow(app, { path: 'pages/discover/index', scene: 1006 });
  assert.equal(foregrounds, 0); await app.ensureAccountReady(); assert.equal(foregrounds, 1); assert.equal(starts, 1);
  lifecycle.onHide(app); app.networkRecovery.dispose(); app.searchAttribution.dispose();
});

test('返回公共页会取消排队的旧前台读取，后续私有访问只恢复自己的读取', async () => {
  for (const reenter of [false, true]) {
    let resolve, starts = 0, foregrounds = 0;
    const pending = new Promise(done => { resolve = done; });
    const session = { status: () => ({ configured: true, phase: 'loading' }), subscribe: () => () => {},
      start() { starts++; return pending; }, async onForeground() { foregrounds++; return { phase: 'ready' }; } };
    const lifecycle = createAppLifecycle({ wxApi: {}, cloudConfig: {}, createCloudSession: () => session,
      createWorkspaceStore: () => ({}), createQuoteSession: () => ({}) });
    const app = {}, options = { scene: 1005, path: 'pages/discover/index' };
    await lifecycle.onLaunch(app, options); await lifecycle.onShow(app, options);
    const first = app.ensureAccountReady(); app.onPublicContentShown();
    const second = app.ensureAccountReady(); app.onPublicContentShown();
    const latest = reenter ? app.ensureAccountReady() : second;
    resolve({ phase: 'offline' }); await Promise.all([first, second, latest]);
    assert.equal(starts, 1); assert.equal(foregrounds, reenter ? 1 : 0);
    lifecycle.onHide(app); app.networkRecovery.dispose(); app.searchAttribution.dispose();
  }
});

function serverFixture({ reporting = true } = {}) {
  const rows = new Map(); let serial = 0, epoch = 0;
  const identity = { APPID: 'resource', OPENID: 'resource_user', FROM_APPID: 'wx58e61dffcbfa4249', FROM_OPENID: 'trusted_user', SOURCE: 'wx_client' };
  const owner = crypto.createHash('sha256').update(identity.FROM_APPID + ':' + identity.FROM_OPENID).digest('hex');
  const ref = name => ({ doc(id) { const key = name + ':' + id; return {
    async get() { return { data: copy(rows.get(key) || null) }; }, async set({ data }) { rows.set(key, copy(data)); },
    async update({ data }) { const row = rows.get(key); row._monitorFence = (row._monitorFence || 0) + data._monitorFence.inc; }
  }; } });
  const db = { command: { inc: inc => ({ inc }) }, collection: ref, async runTransaction(work) { return work({ collection: ref }); } };
  const f = { rows, owner, identity, date: '2026-10-18', reads: 0, failWrite: false };
  const api = createApi({ domain, dates, allowedAppId: identity.FROM_APPID, allowedSources: ['wx_client'],
    clock: () => new Date(f.date + 'T04:00:00Z'), newEpoch: () => 'epoch_' + (++epoch),
    ...(reporting ? { reportOperations: createOperationsReporter(db) } : {}),
    repository: { async transact(scope, operation) {
      f.reads++; const outcome = await operation(copy(rows.get('jiancheng_daka_accounts:' + scope)?.payload || null));
      if (f.failWrite) throw Error('private write failure');
      rows.set('jiancheng_daka_accounts:' + scope, { payload: copy(outcome.account) }); return copy(outcome.result);
    } } });
  f.api = (event, caller = identity) => api(event, caller);
  f.pull = () => f.api({ action: 'pull' });
  f.request = (snapshot, command, extras = {}) => ({ action: 'mutate', operationId: 'operation_' + (++serial), epoch: snapshot.epoch,
    expectedRevision: snapshot.revision, operationDate: f.date, command, ...extras });
  f.events = () => [...rows].filter(([key]) => key.startsWith('monitor_events:')).map(([, value]) => value);
  return f;
}

test('归因新协议只向已存在的同代账户写幂等事件，不创建账户或接受任意身份字段', async () => {
  const f = serverFixture(), event = { action: 'trackDiscovery', epoch: 'epoch_1', kind: 'public_view', searchSource: source() };
  assert.deepEqual(await f.api(event), { ok: true, accepted: false }); assert.equal(f.reads, 0); assert.equal(f.rows.size, 0);
  const initial = await f.pull(); assert.equal(initial.capabilities.searchAttributionMetadata, true);
  assert.equal((await f.api(event)).accepted, true); await f.api(event); assert.equal(f.events().length, 1);
  assert.deepEqual(f.events()[0].payload, source()); assert.equal(f.events()[0].type, 'discovery_page_view');
  for (const malformed of [
    { ...event, openid: 'victim' }, { ...event, searchSource: source({ scene: 1129 }) },
    { ...event, searchSource: source({ route: 'pages/detail/index' }) }, { ...event, searchSource: source({ templateKey: 'unknown' }) },
    { ...event, searchSource: source({ query: 'private' }) }, { ...event, kind: 'habit_created' },
    { ...event, searchSource: source({ scene: '1005' }) }
  ]) assert.equal((await f.api(malformed)).code, 'INVALID_REQUEST');
  assert.equal((await f.api(event, { ...f.identity, FROM_APPID: 'wx0000000000000000' })).code, 'UNAUTHORIZED');
  const account = f.rows.get('jiancheng_daka_accounts:' + f.owner);
  account.payload.epoch = 'epoch_after_delete'; account.payload.cleanupPending = true;
  assert.equal((await f.api({ ...event, kind: 'template_selected' })).accepted, false); assert.equal(f.events().length, 1);
  assert.equal((await serverFixture({ reporting: false }).pull()).capabilities.searchAttributionMetadata, false);
});

test('创建与打卡归因仅随真实服务端成功写入；失败、重放、未改变状态不增加转化', async () => {
  const f = serverFixture(), initial = await f.pull();
  const request = f.request(initial, { type: 'create', id: 'habit_read', plan: plan() }, { searchSource: source() });
  f.failWrite = true; assert.equal((await f.api(request)).code, 'SERVICE_UNAVAILABLE'); assert.equal(f.events().length, 0);
  f.failWrite = false; const created = await f.api(request); assert.equal(created.ok, true);
  await f.api(request); assert.equal(f.events().length, 1); assert.deepEqual(f.events()[0].payload.searchSource, source());
  const completed = f.request(created, { type: 'complete', id: 'habit_read', date: f.date }, { searchSource: source() });
  const result = await f.api(completed); assert.equal(result.ok, true); await f.api(completed);
  await f.api(f.request(result, { type: 'complete', id: 'habit_read', date: f.date }, { searchSource: source() }));
  assert.equal(f.events().length, 2); assert.equal(f.events()[1].type, 'checkin_completed');
  assert.deepEqual(f.events()[1].payload.searchSource, source());
  assert.doesNotMatch(JSON.stringify(f.events()), /读一会儿|private write failure/);
});

test('客户端capability协商兼容旧云，结果未知重试固定原始归因且遥测不改变账户状态', async () => {
  for (const legacy of [true, false]) {
    const f = serverFixture(), calls = []; let selected = source(), lose = !legacy;
    const session = createCloudSession({}, { enabled: true, envId: 'fixture' }, () => async event => {
      calls.push(copy(event)); const result = await f.api(event);
      if (legacy) delete result.capabilities;
      if (event.action === 'mutate' && lose) { lose = false; throw Error('lost acknowledgment'); }
      return result;
    }, { now: () => Date.parse(f.date + 'T04:00:00Z'), searchSource: () => selected });
    await session.start(); const before = session.read();
    assert.equal(await session.trackDiscovery('public_view', source()), !legacy);
    assert.deepEqual(session.read(), before); assert.equal(session.status().pending, 0);
    const command = { type: 'create', id: 'habit_read', plan: plan() };
    if (legacy) await session.dispatch(command);
    else { await assert.rejects(() => session.dispatch(command)); selected = source({ visitId: 'new_visit', scene: 1006 }); await session.retry(); }
    const mutations = calls.filter(call => call.action === 'mutate');
    if (legacy) { assert.equal(calls.some(call => call.action === 'trackDiscovery'), false); assert.equal(Object.hasOwn(mutations[0], 'searchSource'), false); }
    else { assert.deepEqual(mutations[0], mutations[1]); assert.deepEqual(mutations[0].searchSource, source()); }
  }
});

test('名称搜索直达今日的入口、创建和打卡保留同次来源，默认路径与未知路径分开', async () => {
  const f = serverFixture();
  const lifecycle = createAppLifecycle({ wxApi: {}, cloudConfig: { enabled: true, envId: 'fixture' },
    createCloudSession: (wxApi, config, _factory, options) => createCloudSession(wxApi, config, () => event => f.api(event),
      { ...options, now: () => Date.parse(f.date + 'T04:00:00Z') }),
    createWorkspaceStore: () => ({}), createQuoteSession: () => ({}) });
  const app = {}, options = { path: 'pages/today/index', scene: 1005, query: { private: 'not retained' } };
  await lifecycle.onLaunch(app, options); await lifecycle.onShow(app, options); await tick();
  await app.cloudSession.dispatch({ type: 'create', id: 'habit_read', plan: plan() });
  await app.cloudSession.dispatch({ type: 'complete', id: 'habit_read', date: f.date });
  const events = f.events(), initial = events.find(event => event.type === 'discovery_entry');
  assert.equal(events.filter(event => event.type === 'discovery_entry').length, 1);
  assert.equal(initial.payload.route, 'pages/today/index'); assert.equal(initial.payload.scene, 1005);
  for (const type of ['habit_created', 'checkin_completed']) assert.deepEqual(events.find(event => event.type === type).payload.searchSource, initial.payload);
  assert.doesNotMatch(JSON.stringify(events), /not retained|query|private/);
  assert.equal(entry({ scene: 1005 }).route, 'pages/today/index');
  assert.equal(entry({ path: 'pages/detail/index', scene: 1005 }).route, '');
  assert.equal((await f.api({ action: 'trackDiscovery', epoch: 'epoch_1', kind: 'public_view',
    searchSource: { visitId: 'bad_public', scene: 1005, route: 'pages/today/index' } })).code, 'INVALID_REQUEST');
  lifecycle.onHide(app); app.networkRecovery.dispose(); app.searchAttribution.dispose();
});
