const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createCloudTransport, prepareCloudConnection } = require('../miniprogram/services/cloud-transport');
const { createCloudSession } = require('../miniprogram/services/cloud-session');
const { createAppLifecycle } = require('../miniprogram/services/app-lifecycle');
const { createWorkspaceStore } = require('../miniprogram/services/workspace-store');
const { fixture, dates } = require('./helpers/cloud-fixture.cjs');
const target = { enabled: true, mode: 'shared', resourceAppid: 'wx1234567890abcdef', envId: 'startup-test',
  storageNamespace: 'jiancheng_daka', functionName: 'jiancheng_daka_api' };
const flush = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
function fakeClock() {
  let time = 0, serial = 0;
  const timers = new Map();
  return { timers, now: () => time,
    setTimer(callback, delay) { const id = ++serial; timers.set(id, { callback, at: time + delay }); return id; },
    clearTimer(id) { timers.delete(id); },
    advance(delay) { time += delay; for (const [id, timer] of [...timers]) if (timer.at <= time) { timers.delete(id); timer.callback(); } }
  };
}

test('native shared authentication starts before optional factories and is reused by the only startup pull', async () => {
  const f = fixture(), gate = deferred(), events = [], samples = []; let inits = 0, calls = 0;
  const wxApi = { cloud: { Cloud: class {
    init() { inits++; events.push('native-init'); return gate.promise; }
    async callFunction({ data }) { calls++; return { result: await f.api(data) }; }
  } } };
  const lifecycle = createAppLifecycle({ wxApi, cloudConfig: target, prepareCloudConnection, createCloudSession, createWorkspaceStore,
    createQuoteSession() { events.push('quote-factory'); return {}; },
    createOperationsMonitor() { events.push('monitor-factory'); return {}; },
    createAppearanceClient() { events.push('appearance-factory'); return {}; },
    createAppearanceController: () => ({ ensureRead() {} }), onStartupTiming: value => samples.push(value) });
  const app = {};
  const launch = lifecycle.onLaunch(app), show = lifecycle.onShow(app);
  assert.equal(events[0], 'native-init');
  assert.equal(inits, 1); assert.equal(calls, 0);
  gate.resolve({ errCode: 0 });
  await Promise.all([launch, show]);
  assert.equal(calls, 1); assert.equal(app.cloudSession.status().ready, true);
  assert.deepEqual(samples.map(sample => sample.stage), ['shared_init', 'account_pull', 'state_accept', 'startup_read']);
  for (const sample of samples) {
    assert.deepEqual(Object.keys(sample).sort(), ['code', 'durationMs', 'stage']);
    assert.equal(sample.code, 'OK'); assert.ok(sample.durationMs >= 0);
  }
});

test('failed cold start has one pull, offers explicit retry, and later foreground still recovers', async () => {
  const f = fixture(); let calls = 0;
  const lifecycle = createAppLifecycle({ wxApi: {}, cloudConfig: target,
    createCloudSession: (wx, config) => createCloudSession(wx, config, () => async event => {
      if (++calls === 1) throw Error('startup failed');
      return f.api(event);
    }), createWorkspaceStore, createQuoteSession: () => ({}) });
  const app = {};
  const launch = lifecycle.onLaunch(app), show = lifecycle.onShow(app);
  await Promise.all([launch, show]);
  assert.equal(calls, 1); assert.equal(app.cloudSession.status().phase, 'offline');
  await app.cloudSession.start();
  assert.equal(calls, 2); assert.equal(app.cloudSession.status().ready, true);
  lifecycle.onHide(app); await lifecycle.onShow(app);
  assert.equal(calls, 2, 'fresh explicit confirmation is reused on the next foreground');
});

test('invalid session targets do not prepare cloud connections and optional appearance faults do not block core reading', async () => {
  for (const configured of [false, true]) {
    const f = fixture(); let preparations = 0, calls = 0;
    const lifecycle = createAppLifecycle({ wxApi: {}, cloudConfig: { ...target, storageNamespace: configured ? 'jiancheng_daka' : 'invalid' },
      prepareCloudConnection() { preparations++; },
      createCloudSession: (wx, config) => createCloudSession(wx, config, () => event => { calls++; return f.api(event); }),
      createWorkspaceStore, createQuoteSession: () => ({}), createAppearanceClient() { throw Error('appearance unavailable'); },
      createAppearanceController() { throw Error('unreachable'); } });
    const app = {}; await lifecycle.onLaunch(app); await lifecycle.onShow(app);
    assert.equal(preparations, configured ? 1 : 0); assert.equal(calls, configured ? 1 : 0);
    assert.equal(app.cloudSession.status().ready, configured); assert.equal(app.appearanceController, null);
  }
});

test('a timed-out pull releases busy and its late snapshot cannot replace a successful retry', async () => {
  const f = fixture(), old = await f.pull(), gate = deferred(), clock = fakeClock(), samples = [];
  await f.seed(); let reads = 0;
  const session = createCloudSession({}, target, () => () => ++reads === 1 ? gate.promise : f.pull(),
    { ...clock, onTiming: sample => samples.push(sample) });
  const failure = assert.rejects(session.start(), { code: 'CLOUD_READ_TIMEOUT' });
  clock.advance(8000); await failure;
  assert.equal(session.status().busy, false); assert.equal(session.status().phase, 'offline');
  assert.throws(() => session.read());
  await session.start();
  const confirmed = session.status();
  assert.equal(confirmed.count, 1);
  gate.resolve({ ...old, epoch: 'obsolete-epoch' }); await flush();
  assert.equal(session.status().epoch, confirmed.epoch); assert.equal(session.status().count, 1);
  assert.equal(session.status().lastSyncedAt, confirmed.lastSyncedAt);
  assert.equal(samples[0].code, 'TIMEOUT'); assert.equal(clock.timers.size, 0);
});

test('hung shared initialization expires for all waiters, can retry, and never calls the old instance', async () => {
  const first = deferred(), second = deferred(), clock = fakeClock(), calls = []; let inits = 0;
  const wxApi = { cloud: { Cloud: class {
    init() { this.number = ++inits; return this.number === 1 ? first.promise : second.promise; }
    async callFunction() { calls.push(this.number); return { result: { ok: true } }; }
  } } };
  const core = createCloudTransport(wxApi, target, clock);
  const appearance = createCloudTransport(wxApi, { ...target, functionName: 'jiancheng_daka_features' }, clock);
  const failures = Promise.allSettled([core({ action: 'pull' }), appearance({ action: 'getAppearance' })]);
  assert.equal(inits, 1); clock.advance(8000);
  for (const result of await failures) assert.equal(result.reason.code, 'CLOUD_INIT_TIMEOUT');
  const retry = core({ action: 'pull' }); assert.equal(inits, 2);
  second.resolve({ errCode: 0 }); await retry;
  first.resolve({ errCode: 0 }); await flush();
  assert.deepEqual(calls, [2]); assert.equal(clock.timers.size, 0);
});

test('initialization and account pull share one eight-second read budget', async () => {
  const f = fixture(), init = deferred(), reply = deferred(), clock = fakeClock(); let calls = 0;
  const wxApi = { cloud: { Cloud: class {
    init() { return init.promise; }
    callFunction() { calls++; return reply.promise; }
  } } };
  const session = createCloudSession(wxApi, target, undefined, clock);
  const failure = assert.rejects(session.start(), { code: 'CLOUD_READ_TIMEOUT' });
  clock.advance(6000); init.resolve({ errCode: 0 }); await flush();
  assert.equal(calls, 1); clock.advance(1999); assert.equal(session.status().busy, true);
  clock.advance(1); await failure;
  assert.equal(session.status().busy, false); assert.equal(session.status().lastErrorCode, 'CLOUD_READ_TIMEOUT');
  reply.resolve({ result: await f.pull() }); await flush();
  assert.equal(session.status().connected, false, 'a late first reply does not revive the expired read');
  assert.equal(clock.timers.size, 0);
});

test('concurrent startup, retry and foreground readers share the same pending pull', async () => {
  const f = fixture(), gate = deferred(); let calls = 0;
  const session = createCloudSession({}, target, () => async () => { calls++; await gate.promise; return f.pull(); });
  const work = [session.start(), session.start(), session.refresh(), session.onForeground()];
  assert.equal(calls, 1); gate.resolve(); await Promise.all(work);
  assert.equal(calls, 1); assert.equal(session.status().ready, true);
});

test('an expired read waiting on authentication is never sent after a fresh retry', async () => {
  const f = fixture(), init = deferred(), clock = fakeClock(); let calls = 0;
  const wxApi = { cloud: { Cloud: class {
    init() { return init.promise; }
    async callFunction() { calls++; return { result: await f.pull() }; }
  } } };
  const session = createCloudSession(wxApi, target, undefined, { ...clock, initTimeoutMs: 20000 });
  const failure = assert.rejects(session.start(), { code: 'CLOUD_READ_TIMEOUT' });
  clock.advance(8000); await failure;
  const retry = session.start();
  assert.equal(session.status().lastError, ''); assert.equal(session.status().lastErrorCode, '');
  init.resolve({ errCode: 0 }); await retry; await flush();
  assert.equal(calls, 1, 'only the current retry reaches the account function');
  assert.equal(session.status().ready, true); assert.equal(clock.timers.size, 0);
});

test('diagnostic failures cannot interrupt startup and read deadlines do not expire a pending write', async () => {
  const f = fixture(); f.date = dates.today(); await f.seed();
  const clock = fakeClock(), gate = deferred(); let writeEvent;
  const session = createCloudSession({}, target, () => event => {
    if (event.action === 'pull') return f.api(event);
    writeEvent = event; return gate.promise;
  }, { ...clock, now: () => Date.parse(f.date + 'T04:00:00Z'), onTiming() { throw Error('log unavailable'); } });
  await session.start();
  const writing = session.dispatch({ type: 'complete', id: 'read', date: f.date });
  clock.advance(30000); await flush();
  assert.equal(session.status().pending, 1); assert.equal(session.status().busy, true);
  assert.equal(clock.timers.size, 0, 'the pure-read deadline is not applied to mutations');
  gate.resolve(await f.api(writeEvent)); await writing;
  assert.equal(session.status().pending, 0); assert.equal(session.status().ready, true);
});

function isolated(source) {
  const result = spawnSync(process.execPath, ['-e', source], { cwd: path.resolve(__dirname, '..'), encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.stderr || result.error?.message || result.stdout);
  return result.stdout.trim() ? JSON.parse(result.stdout) : null;
}

test('App registration does not load optional factories before onLaunch can prepare authentication', () => {
  isolated(`
    const assert = require('node:assert/strict'), path = require('node:path');
    global.wx = {}; global.App = () => {};
    require('./miniprogram/app');
    for (const name of ['appearance-client', 'appearance', 'operations-monitor']) {
      assert.equal(require.cache[path.resolve('miniprogram/services/' + name + '.js')], undefined, name);
    }
  `);
});

test('disabled Today capabilities do not load service graphs or construct disabled clients', () => {
  isolated(`
    const assert = require('node:assert/strict'), path = require('node:path');
    const { createCloudSession } = require('./miniprogram/services/cloud-session');
    const { createWorkspaceStore } = require('./miniprogram/services/workspace-store');
    global.wx = {}; const session = createCloudSession(wx, require('./miniprogram/config/cloud'));
    const app = { cloudSession: session, store: createWorkspaceStore(session) }; global.getApp = () => app;
    let definition; global.Page = value => { definition = value; };
    require('./miniprogram/pages/today/index');
    const page = { ...definition, data: structuredClone(definition.data), setData(value) { Object.assign(this.data, value); } };
    page.onShow(); page.onUnload();
    for (const name of ['features-client', 'supervision-client', 'media-client', 'photo-checkin']) {
      assert.equal(require.cache[path.resolve('miniprogram/services/' + name + '.js')], undefined, name);
    }
    assert.equal(app.featuresClient, undefined); assert.equal(app.supervisionClient, undefined); assert.equal(app.mediaClient, undefined);
  `);
});

test('Today still enables reminders independently when sharing and pinning are disabled', () => {
  isolated(`
    const assert = require('node:assert/strict');
    require('./miniprogram/config/reminders').enabled = true;
    const domain = require('./miniprogram/core/habits');
    const session = { status: () => ({ ready: true, phase: 'ready', accountId: 'a'.repeat(64), epoch: 'test' }), read: () => domain.emptyState() };
    global.wx = {}; const app = { cloudSession: session, store: require('./miniprogram/services/workspace-store').createWorkspaceStore(session) };
    global.getApp = () => app; let definition; global.Page = value => { definition = value; };
    require('./miniprogram/pages/today/index');
    const page = { ...definition, data: structuredClone(definition.data), setData(value) { Object.assign(this.data, value); } };
    page.refresh(); assert.equal(page.data.remindersEnabled, true); assert.equal(app.featuresClient.status().enabled, false);
  `);
});

test('a normal pull loads no media or cleanup implementation, even while storage enforcement is enabled', () => {
  const result = isolated(`
    const assert = require('node:assert/strict'), path = require('node:path'), Module = require('node:module');
    for (const name of ['node:http', 'node:https']) require(name).request = () => { throw Error('NETWORK_FORBIDDEN'); };
    global.fetch = () => { throw Error('NETWORK_FORBIDDEN'); };
    const folder = path.resolve('cloudfunctions/jiancheng_daka_api');
    require(folder + '/lib/supervision-config').storageReady = true;
    const state = require(folder + '/shared/habits').emptyState(); let reads = 0;
    const sdk = { init() {}, getWXContext: () => ({ APPID: 'wx-startup-test', OPENID: 'fixture', SOURCE: 'wx_client' }),
      database: () => ({ collection(name) { assert.equal(name, 'jiancheng_daka_accounts'); return { doc() { return { async get() {
        reads++; return { data: { payload: { epoch: 'startup', revision: 0, receipts: [], state } } } } }; } }; } }) };
    process.env.HABIT_API_ENABLED = 'true'; process.env.HABIT_MINIPROGRAM_ONLY = 'true'; process.env.HABIT_APP_ID = 'wx-startup-test';
    process.env.HABIT_SIDECAR_CLEANUP_ENABLED = 'true';
    const load = Module._load; Module._load = function(name, ...args) { return name === 'wx-server-sdk' ? sdk : load.call(this, name, ...args); };
    const entry = require(folder + '/index');
    entry.main({ action: 'pull' }).then(result => {
      assert.equal(result.ok, true); assert.equal(reads, 1);
      for (const name of ['media', 'supervision', 'media-worker', 'media-provider', 'supervision-repository', 'sidecar-cleanup', 'features-repository', 'limits']) {
        assert.equal(require.cache[path.join(folder, 'lib', name + '.js')], undefined, name);
      }
      console.log(JSON.stringify({ reads, modules: Object.keys(require.cache).filter(name => name.startsWith(folder)).length }));
    }).catch(error => { console.error(error); process.exitCode = 1; });
  `);
  assert.equal(result.reads, 1);
});
