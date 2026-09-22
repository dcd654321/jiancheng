# Cloud-First Habit Data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the WeChat cloud database the only authoritative habit store while retaining a validated local cache and durable offline queue.

**Architecture:** Keep the existing server protocol, account transaction, revision, epoch and idempotency model. Replace the client’s explicit local/cloud source switch with a persisted cloud binding, one-time data consent, automatic startup pull and foreground retry; the old native store remains read-only only long enough to export pre-release test data. Cloud enablement is staged after local tests and requires a separately confirmed real-environment write/delete test.

**Tech Stack:** Native WeChat Mini Program WXML/WXSS/CommonJS, Node.js `node:test`, WeChat Cloud Development, `wx-server-sdk` 4.0.2, official WeChat DevTools CLI.

**Spec:** `docs/superpowers/specs/2026-09-15-cloud-first-data-design.md`

## Global Constraints

- Cloud database is authoritative; local storage is only confirmed cache, offline queue, binding and UI preferences.
- No phone, avatar, nickname, contacts, location, custom account, token or client-side AppSecret.
- Identity comes only from cloud-function `APPID`, `OPENID` and allowed `SOURCE`.
- No automatic AI request, third-party database, image/file cloud storage or recommendation-content backend in this release.
- No periodic polling: one cold-start pull, foreground sync only when stale for 30 seconds or when pending operations exist, and one request in flight.
- Daily record operations may queue offline; create/edit/status/settings remain online-confirmed.
- Existing `yidian.native.v1` data is never uploaded automatically and is not deleted except after an explicit confirmed data clear.
- `config/cloud.js` remains `enabled:false` until the real cloud gates in Task 8 pass.
- Any cloud write, environment-variable change or purge requires an action-time confirmation and an exact environment check.
- Do not store or reproduce the previously disclosed AppSecret; it must be regenerated before public release.
- Preserve the existing limits: 5 active habits, 100 retained habits, 200 queued client operations, 256 recent server receipts and a 700 KiB account document ceiling.
- Repository has no Git metadata. Replace each commit step with the named SHA-256 checkpoint under `D:\codex\coding\yidian-recovery`; never overwrite an earlier checkpoint.
- At the start of every task's PowerShell session set `$nodeExe='C:\Users\dcd\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'`; this is the verified Node 24.19.0 test runner.

## File Map and Interfaces

- Create `miniprogram/services/cloud-binding.js`: persist and validate consent and the last verified account binding, scoped by environment.
- Modify `miniprogram/services/cloud-session.js`: expose `start()`, `acceptConsent(true)`, `onForeground()`, `purge('DELETE_MY_DATA')`, `status()` and existing read/dispatch/retry/conflict APIs.
- Modify `miniprogram/services/sync-engine.js`: add confirmed purge and automatic queue flushing without weakening revision checks.
- Modify `miniprogram/services/workspace-store.js`: become a cloud-only facade; retain legacy export/clear helpers but remove source switching.
- Modify `miniprogram/services/ui.js`: represent `needsConsent`, `loading`, `ready` and `offline` without rendering a false empty state.
- Create `miniprogram/services/app-lifecycle.js`: serialize launch bootstrap and foreground sync behind one caught `dataReady` promise.
- Modify `miniprogram/app.js`: delegate startup and foreground events to the testable lifecycle coordinator.
- Modify `miniprogram/pages/today/*`, `progress/*`, `detail/*`, `edit/*`, `mine/*`, `sync/*`, `restore/*`: remove developer/data-source UI and expose consent, sync, backup and delete states.
- Modify `tests/cloud-session.test.cjs`, `workspace.test.cjs`, `pages.test.cjs`, `backup.test.cjs`; create `tests/cloud-binding.test.cjs` and `tests/app-lifecycle.test.cjs`.
- Modify `README.md`, `docs/BACKLOG.md`, `docs/CLOUD-SYNC.md`, `docs/VERIFICATION.md`, `docs/CHANGELOG-RELEASE-PREP.md` after verified behavior exists.

The stable client interfaces after Task 6 are:

```js
createCloudBinding(wxApi, envId) => {
  keys: { consent: string, binding: string },
  consented(): boolean,
  accept(): void,
  accountId(): string,
  bind(accountId: string): void
}

createCloudSession(wxApi, config, transportFactory?, options?) => {
  status(): { configured, consented, phase, ready, busy, accountId, pending, conflict, lastError, lastSyncedAt },
  start(): Promise<status>,
  acceptConsent(consent: true): Promise<status>,
  onForeground(): Promise<status>,
  read(): HabitState,
  dispatch(command): HabitState | Promise<HabitState>,
  refresh(): Promise<status>,
  retry(): Promise<status>,
  useRemote('DISCARD_PENDING'): Promise<status>,
  purge('DELETE_MY_DATA'): Promise<status>,
  backup(): string
}

createWorkspaceStore(legacyStore, cloudSession) => {
  read(), dispatch(command), exportCsv(includeNotes), rawBackup(), legacyBackup(),
  hasLegacyData(), clear('DELETE_MY_DATA'), contextKey(), info()
}

createAppLifecycle(dependencies) => {
  onLaunch(app): Promise<CloudStatus>,
  onShow(app): Promise<CloudStatus | null>
}
```

---

### Task 1: Persist consent and verified account binding

**Files:**
- Create: `miniprogram/services/cloud-binding.js`
- Create: `tests/cloud-binding.test.cjs`

**Interfaces:**
- Consumes: `wxApi.getStorageSync`, `setStorageSync`; `removeStorageSync` is not used by normal startup.
- Produces: `createCloudBinding(wxApi, envId)`, `CONSENT_SUFFIX`, `BINDING_SUFFIX`.

- [ ] **Step 1: Write failing binding tests**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { storageFixture } = require('./helpers/cloud-fixture.cjs');
const { createCloudBinding } = require('../miniprogram/services/cloud-binding');

test('consent and account binding persist without network and are isolated by environment', () => {
  const wx = storageFixture();
  const first = createCloudBinding(wx, 'env-a');
  assert.equal(first.consented(), false);
  assert.equal(first.accountId(), '');
  first.accept();
  first.bind('a'.repeat(64));
  const resumed = createCloudBinding(wx, 'env-a');
  assert.equal(resumed.consented(), true);
  assert.equal(resumed.accountId(), 'a'.repeat(64));
  assert.equal(createCloudBinding(wx, 'env-b').consented(), false);
});

test('malformed binding fails closed and write failure never reports consent', () => {
  const wx = storageFixture();
  const binding = createCloudBinding(wx, 'env-a');
  wx.setStorageSync(binding.keys.binding, 'not-an-account');
  assert.throws(() => binding.accountId(), /绑定损坏/);
  wx.failWrite = true;
  assert.throws(() => binding.accept(), /保存失败/);
  assert.equal(binding.consented(), false);
});
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```powershell
$nodeExe='C:\Users\dcd\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
& $nodeExe --test tests/cloud-binding.test.cjs
```

Expected: FAIL with `Cannot find module '../miniprogram/services/cloud-binding'`.

- [ ] **Step 3: Implement the binding store**

```js
'use strict';
const CONSENT_SUFFIX = 'yidian.cloud.consent.v1';
const BINDING_SUFFIX = 'yidian.cloud.binding.v1';
const ACCOUNT = /^[a-f0-9]{64}$/;

function createCloudBinding(wxApi, envId) {
  if (typeof envId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(envId)) throw Error('云环境标识无效');
  const scope = `yidian.cloud.env:${envId}:`;
  const keys = { consent: scope + CONSENT_SUFFIX, binding: scope + BINDING_SUFFIX };
  function write(key, value) {
    try { wxApi.setStorageSync(key, value); }
    catch (_) { throw Error('云账户设置保存失败，请检查本机空间'); }
  }
  return {
    keys,
    consented: () => wxApi.getStorageSync(keys.consent) === true,
    accept() { write(keys.consent, true); },
    accountId() {
      const value = wxApi.getStorageSync(keys.binding);
      if (value == null || value === '') return '';
      if (!ACCOUNT.test(value)) throw Error('云账户绑定损坏，已停止读取');
      return value;
    },
    bind(accountId) {
      if (!ACCOUNT.test(accountId || '')) throw Error('云账户标识无效');
      write(keys.binding, accountId);
    }
  };
}
module.exports = { createCloudBinding, CONSENT_SUFFIX, BINDING_SUFFIX };
```

- [ ] **Step 4: Run targeted and full tests**

```powershell
& $nodeExe --test tests/cloud-binding.test.cjs
& $nodeExe --test 'tests/*.test.cjs'
```

Expected: both commands PASS; existing count remains 135 plus the new tests.

- [ ] **Step 5: Create checkpoint B016-T1**

Copy `cloud-binding.js`, its test and current changelog to `D:\codex\coding\yidian-recovery\20260915-B016-T1-cloud-binding\project`, then compare every source/backup SHA-256. Append the file list and hashes to `docs/CHANGELOG-RELEASE-PREP.md`.

---

### Task 2: Resume cached cloud state and bootstrap automatically

**Files:**
- Modify: `miniprogram/services/cloud-session.js`
- Create: `miniprogram/services/app-lifecycle.js`
- Modify: `miniprogram/app.js`
- Modify: `tests/cloud-session.test.cjs`
- Create: `tests/app-lifecycle.test.cjs`

**Interfaces:**
- Consumes: `createCloudBinding`, `createSyncEngine`, `createCloudTransport`.
- Produces: `start()`, `acceptConsent(true)`, persisted cache resume, `createAppLifecycle(dependencies)` and `app.dataReady`.

- [ ] **Step 1: Write failing session lifecycle tests**

```js
async function setup({ route, now } = {}) {
  const f = fixture(), snapshot = await f.seed(), wx = storageFixture(), requests = [];
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
```

Add `tests/app-lifecycle.test.cjs` against the real lifecycle coordinator used by `app.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAppLifecycle } = require('../miniprogram/services/app-lifecycle');

const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

test('launch creates services once and foreground waits for bootstrap', async () => {
  const gate = deferred();
  let starts = 0, foregrounds = 0;
  const session = {
    start() { starts += 1; return gate.promise; },
    onForeground() { foregrounds += 1; return Promise.resolve({ phase: 'ready' }); },
    status() { return { phase: 'offline', ready: true }; }
  };
  const lifecycle = createAppLifecycle({
    wxApi: {}, cloudConfig: {}, aiConfig: {},
    createStore: () => ({ kind: 'legacy' }),
    createCloudSession: () => session,
    createWorkspaceStore: (legacy, current) => ({ legacy, current }),
    createPlanAssistant: () => ({ kind: 'assistant' }),
    createQuoteSession: () => ({ kind: 'quotes' })
  });
  const app = {};
  lifecycle.onLaunch(app);
  const foreground = lifecycle.onShow(app);
  assert.equal(starts, 1);
  assert.equal(foregrounds, 0);
  gate.resolve({ phase: 'ready' });
  assert.deepEqual(await foreground, { phase: 'ready' });
  assert.equal(foregrounds, 1);
  assert.equal(app.store.current, session);
});
```

- [ ] **Step 2: Run tests and verify RED**

```powershell
& $nodeExe --test tests/cloud-session.test.cjs tests/app-lifecycle.test.cjs
```

Expected: FAIL because `start`, `acceptConsent`, `onForeground` and `dataReady` do not exist.

- [ ] **Step 3: Add session phases and cache resume**

Change the declaration to `function createCloudSession(wxApi, config, transportFactory = createCloudTransport, options = {})` and refactor its state around these transitions while retaining `connect()` temporarily as a compatibility alias for existing tests:

```js
let engine = null, call = null, busy = false, phase = 'needsConsent', lastAttemptAt = 0, lastError = '';
const binding = createCloudBinding(wxApi, config.envId);
const now = options && typeof options.now === 'function' ? options.now : Date.now;

function restoreCachedEngine() {
  if (!configured || !binding.consented()) return;
  const savedAccount = binding.accountId();
  if (!savedAccount) { phase = 'loading'; return; }
  try {
    call = transportFactory(wxApi, { ...config, consent: true });
    const candidate = createSyncEngine({ storage, call, accountId: savedAccount, consent: true });
    candidate.read();
    engine = candidate;
    accountId = savedAccount;
    phase = 'ready';
  } catch (error) {
    call = null;
    phase = 'loading';
    lastError = error.message || '本机同步缓存损坏，已停止写入';
  }
}

async function loadRemote() {
  const transport = call || transportFactory(wxApi, { ...config, consent: true });
  const snapshot = await transport({ action: 'pull' });
  if (!snapshot || !snapshot.ok) throw Error(snapshot && snapshot.message || '读取云端失败');
  if (!engine || accountId !== snapshot.accountId) {
    const candidate = createSyncEngine({ storage, call: transport, accountId: snapshot.accountId, consent: true });
    const cached = storage.getStorageSync(PREFIX + snapshot.accountId);
    if (cached) candidate.observeRemote(snapshot); else candidate.attach(snapshot);
    candidate.read();
    engine = candidate; accountId = snapshot.accountId; call = transport;
    binding.bind(snapshot.accountId);
  } else engine.observeRemote(snapshot);
  phase = 'ready';
  lastError = '';
}

async function start() {
  if (!binding.consented()) { phase = 'needsConsent'; lastError = ''; return status(); }
  if (!configured) {
    phase = 'loading';
    lastError = '云环境尚未配置';
    throw Error(lastError);
  }
  if (!engine) phase = 'loading';
  return exclusive(async () => {
    lastAttemptAt = now();
    try { await loadRemote(); }
    catch (error) {
      lastError = error.message || '读取云端失败';
      if (engine) { phase = 'offline'; return; }
      phase = 'loading';
      throw error;
    }
  });
}

async function acceptConsent(consent) {
  if (consent !== true) throw Error('请先阅读并同意数据说明');
  binding.accept();
  return start();
}
```

Call `restoreCachedEngine()` once before returning the session object. `status()` includes `consented`, `phase`, `ready: Boolean(engine)`, `accountId` and the session-level `lastError` when no engine error exists. `start()` returns `needsConsent` without transport when consent is absent. A cached engine remains readable in `offline`; a first pull failure remains non-editable in `loading` with `lastError`, which the workspace maps to a retry state.

Create `app-lifecycle.js` with the exact coordinator below. Its `settle` function converts lifecycle rejections into visible session status, preventing unhandled promise rejections without making page actions such as consent silently succeed:

```js
'use strict';

function createAppLifecycle(dependencies) {
  const d = dependencies;
  function settle(app, work) {
    app.dataReady = Promise.resolve(work).catch(() => app.cloudSession.status());
    return app.dataReady;
  }
  return {
    onLaunch(app) {
      app.cloudSession = d.createCloudSession(d.wxApi, d.cloudConfig);
      app.store = d.createWorkspaceStore(d.createStore(d.wxApi), app.cloudSession);
      app.planAssistant = d.createPlanAssistant(d.wxApi, d.cloudConfig, d.aiConfig);
      app.quoteSession = d.createQuoteSession(d.wxApi);
      return settle(app, app.cloudSession.start());
    },
    onShow(app) {
      if (!app.cloudSession) return Promise.resolve(null);
      return settle(app, Promise.resolve(app.dataReady).then(() => app.cloudSession.onForeground()));
    }
  };
}

module.exports = { createAppLifecycle };
```

In `app.js`, create the coordinator once and delegate both lifecycle callbacks:

```js
const { createAppLifecycle } = require('./services/app-lifecycle');
const lifecycle = createAppLifecycle({ wxApi: wx, cloudConfig, aiConfig, createStore,
  createCloudSession, createWorkspaceStore, createPlanAssistant, createQuoteSession });

App({
  onLaunch() { return lifecycle.onLaunch(this); },
  onShow() { return lifecycle.onShow(this); }
});
```

- [ ] **Step 4: Run targeted and full tests**

```powershell
& $nodeExe --test tests/cloud-binding.test.cjs tests/cloud-session.test.cjs tests/app-lifecycle.test.cjs
& $nodeExe --test 'tests/*.test.cjs'
```

Expected: PASS with no network call before consent and no false ready state after a failed first pull.

- [ ] **Step 5: Create checkpoint B016-T2**

Snapshot the four modified/created files, binding file/test and changelog under `20260915-B016-T2-cloud-bootstrap`; verify SHA-256 equality and record the result.

---

### Task 3: Replace source switching with a cloud-only workspace facade

**Files:**
- Modify: `miniprogram/services/workspace-store.js`
- Modify: `miniprogram/services/ui.js`
- Modify: `tests/workspace.test.cjs`
- Modify: `tests/backup.test.cjs`

**Interfaces:**
- Consumes: session `status/read/dispatch/backup`; legacy `read/rawBackup`.
- Produces: one cloud workspace with readiness errors and read-only legacy export.

- [ ] **Step 1: Replace dual-source tests with failing cloud-authority tests**

```js
async function setup(override, { consent = true } = {}) {
  const f = fixture();
  f.date = dates.today();
  await f.seed();
  const wx = storageFixture(), calls = [];
  const session = createCloudSession(wx, { enabled: true, envId: 'test-env' }, () => async event => {
    calls.push(event);
    return override ? override(event, f) : f.api(event);
  });
  const local = createStore(wx), store = createWorkspaceStore(local, session);
  local.dispatch({ type: 'create', id: 'local-only', startDate: f.date,
    plan: plan({ title: '仅在本机' }) });
  if (consent) await session.acceptConsent(true);
  return { f, wx, calls, session, local, store };
}

test('workspace never reads or writes legacy habits as active data', async () => {
  const h = await setup();
  const legacyRaw = h.wx.getStorageSync(STORAGE_KEY);
  assert.equal(h.store.info().source, 'cloud');
  assert.equal(h.store.read().habits[0].id, 'read');
  h.store.dispatch(rec(h.f));
  assert.equal(h.session.status().pending, 1);
  assert.equal(h.wx.getStorageSync(STORAGE_KEY), legacyRaw);
  assert.equal(h.store.hasLegacyData(), true);
  assert.equal(typeof h.store.legacyBackup(), 'string');
  assert.equal(h.store.useLocal, undefined);
  assert.equal(h.store.useCloud, undefined);
});

test('workspace exposes consent/loading without returning a fake empty state', () => {
  const legacy = { read() { throw Error('must not read legacy'); }, rawBackup() { return '{}'; } };
  const needsConsent = { status: () => ({ ready: false, phase: 'needsConsent' }) };
  const store = createWorkspaceStore(legacy, needsConsent);
  assert.throws(() => store.read(), error => error.code === 'NEEDS_CONSENT');
  const loading = createWorkspaceStore(legacy, { status: () => ({ ready: false, phase: 'loading' }) });
  assert.throws(() => loading.read(), error => error.code === 'DATA_LOADING');
});
```

Replace the workspace-specific restore test in `tests/backup.test.cjs` with this read-only legacy-export contract:

```js
test('cloud workspace exposes old local data only as an unchanged raw export', () => {
  const f = fixture();
  f.store.restoreBackup(f.store.previewBackup(raw()), 'RESTORE_LOCAL');
  const before = f.store.rawBackup();
  const session = {
    status: () => ({ ready: true, phase: 'ready', accountId: 'a'.repeat(64), pending: 0 }),
    read: () => sample(), backup: () => '{"format":"yidian-cloud-backup-v1"}'
  };
  const workspace = createWorkspaceStore(f.store, session);
  assert.equal(workspace.legacyBackup(), before);
  assert.equal(workspace.hasLegacyData(), true);
  assert.equal(workspace.previewBackup, undefined);
  assert.equal(workspace.restoreBackup, undefined);
  assert.equal(workspace.recoveryBackup, undefined);
  assert.equal(f.store.rawBackup(), before);
});
```

- [ ] **Step 2: Run tests and verify RED**

```powershell
& $nodeExe --test tests/workspace.test.cjs tests/backup.test.cjs
```

Expected: FAIL because mode remains local and source-switch methods still exist.

- [ ] **Step 3: Implement the cloud-only facade**

```js
function stateError(status) {
  const error = Error(status.phase === 'needsConsent' ? '请先阅读数据说明并开始使用'
    : status.phase === 'loading' && !status.lastError ? '正在读取记录' : status.lastError || '暂时无法读取记录');
  error.code = status.phase === 'needsConsent' ? 'NEEDS_CONSENT'
    : status.phase === 'loading' && !status.lastError ? 'DATA_LOADING' : 'DATA_UNAVAILABLE';
  return error;
}

function createWorkspaceStore(legacy, session) {
  let generation = 0;
  function ready() { const status = session.status(); if (!status.ready) throw stateError(status); return status; }
  return {
    read() { ready(); return session.read(); },
    dispatch(command) { ready(); return session.dispatch(command); },
    contextKey() { const s = session.status(); return `cloud:${s.accountId || 'unbound'}:${generation}`; },
    info() {
      const s = session.status();
      return { source: 'cloud', ready: s.ready, phase: s.phase, pending: s.pending || 0,
        conflict: s.conflict || null, lastError: s.lastError || '', lastSyncedAt: s.lastSyncedAt || '',
        syncText: s.conflict ? '需要处理同步冲突' : s.pending ? `${s.pending}条待同步`
          : s.phase === 'offline' ? '当前离线' : s.ready ? '数据已同步' : '' };
    },
    exportCsv(includeNotes) { ready(); return domain.exportCsv(session.read(), dates.today(), includeNotes); },
    rawBackup() { ready(); return session.backup(); },
    hasLegacyData() { try { return legacy.read().habits.length > 0; } catch (_) { return true; } },
    legacyBackup() { return legacy.rawBackup(); }
  };
}
```

Remove `mode`, `useCloud`, `useLocal`, active local dispatch and local restore methods. Task 6 adds `clear()` only when `session.purge()` exists, so Task 3 remains independently runnable.

Update `ui.read` to map typed readiness errors without putting them in the generic red error box:

```js
function read(page, callback) {
  try {
    const state = store().read();
    page._context = contextKey();
    callback(state, date.today());
    page.setData({ needsConsent: false, loading: false, dataUnavailable: false,
      dataReady: true, syncText: storageInfo().syncText, error: '' });
  } catch (err) {
    if (err.code === 'NEEDS_CONSENT') page.setData({ needsConsent: true, loading: false,
      dataUnavailable: false, dataReady: false, error: '' });
    else if (err.code === 'DATA_LOADING') page.setData({ needsConsent: false, loading: true,
      dataUnavailable: false, dataReady: false, error: '' });
    else page.setData({ needsConsent: false, loading: false, dataUnavailable: true,
      dataReady: false, error: err.message || '暂时无法读取记录' });
  }
}
```

- [ ] **Step 4: Update old tests to the new public contract and run full suite**

Remove assertions that expect local default, explicit switching, disconnect or source-change errors. Preserve tests for stale form context by changing the context through account generation in the fixture, not by calling removed methods.

```powershell
& $nodeExe --test tests/workspace.test.cjs tests/backup.test.cjs tests/pages.test.cjs tests/assistant.test.cjs
& $nodeExe --test 'tests/*.test.cjs'
```

Expected: PASS; no test may require active reads from `yidian.native.v1`.

- [ ] **Step 5: Create checkpoint B016-T3**

Snapshot both services, four changed tests and changelog under `20260915-B016-T3-cloud-workspace`; verify hashes.

---

### Task 4: Automatically flush offline records and refresh on foreground

**Files:**
- Modify: `miniprogram/services/cloud-session.js`
- Modify: `miniprogram/app.js`
- Modify: `miniprogram/services/ui.js`
- Modify: `tests/cloud-session.test.cjs`
- Modify: `tests/app-lifecycle.test.cjs`
- Modify: `tests/workspace.test.cjs`

**Interfaces:**
- Consumes: sync engine `enqueue/flush/refresh`.
- Produces: single-flight background record sync and 30-second foreground freshness gate.

- [ ] **Step 1: Write failing automatic-sync tests**

```js
test('record dispatch is durable before one background flush and reuses its operation id', async () => {
  const started = deferred(), release = deferred();
  const h = await readySetup({ route: async (event, f) => {
    if (event.action === 'mutate') { started.resolve(); await release.promise; }
    return f.api(event);
  } });
  const projected = h.session.dispatch({ type: 'complete', id: 'read', date: h.f.date });
  assert.equal(projected.records['read@' + h.f.date].done, true);
  assert.equal(h.session.status().pending, 1);
  await started.promise;
  h.session.dispatch({ type: 'note', id: 'read', date: h.f.date, note: '继续' });
  assert.equal(h.stats.maxConcurrent, 1);
  release.resolve();
  await h.session.onForeground();
  assert.equal(h.session.status().pending, 0);
  assert.equal(new Set(h.stats.mutationIds).size, 2);
});

test('foreground does not poll before 30 seconds but always retries pending work', async () => {
  let now = 100000;
  const h = await readySetup({ now: () => now });
  const pulls = h.requests.filter(x => x.action === 'pull').length;
  await h.session.onForeground();
  assert.equal(h.requests.filter(x => x.action === 'pull').length, pulls);
  now += 31000;
  await h.session.onForeground();
  assert.equal(h.requests.filter(x => x.action === 'pull').length, pulls + 1);
});
```

- [ ] **Step 2: Run tests and verify RED**

```powershell
& $nodeExe --test tests/cloud-session.test.cjs tests/app-lifecycle.test.cjs tests/workspace.test.cjs
```

Expected: FAIL because record dispatch only enqueues and foreground freshness is not implemented.

- [ ] **Step 3: Implement single-flight automatic synchronization**

For record commands, enqueue synchronously, capture the projected state, then start but do not await one background `retry()`; catch into `lastError` so no unhandled rejection occurs:

```js
function scheduleFlush() {
  if (!background) background = Promise.resolve().then(() => retry())
    .catch(error => { lastError = error.message || '同步失败'; phase = engine ? 'offline' : 'error'; })
    .finally(() => { background = null; });
  return background;
}

if (RECORD_TYPES.includes(command.type)) {
  engine.enqueue(command);
  const projected = engine.read().state;
  scheduleFlush();
  return projected;
}
```

Place this record branch before the `busy` rejection so a second daily action can be durably appended while one mutation acknowledgement is in flight. Management commands retain the `busy` rejection. `onForeground()` must reuse `exclusive`, await a pending background task, flush queue before any pull, and pull only when `now() - lastAttemptAt >= 30000`. A conflict stops automatic calls until the user acts.

Update `ui.mutate` toast logic: daily records show `已记录` when pending reaches zero, otherwise `已记录，待同步`; online management shows `已保存` only after its returned promise resolves.

- [ ] **Step 4: Run automatic-sync, concurrency and old lost-response tests**

```powershell
& $nodeExe --test tests/cloud-session.test.cjs tests/sync.test.cjs tests/workspace.test.cjs tests/app-lifecycle.test.cjs
& $nodeExe --test 'tests/*.test.cjs'
```

Expected: PASS; existing lost-response, concurrent flush, slow pull and conflict tests remain green.

- [ ] **Step 5: Create checkpoint B016-T4**

Snapshot the three services/app files, three tests and changelog under `20260915-B016-T4-auto-sync`; verify hashes.

---

### Task 5: Replace developer UI with consent, loading and sync status

**Files:**
- Modify: `miniprogram/services/ui.js`
- Modify: `miniprogram/pages/today/index.js`
- Modify: `miniprogram/pages/today/index.wxml`
- Modify: `miniprogram/pages/progress/index.wxml`
- Modify: `miniprogram/pages/detail/index.wxml`
- Modify: `miniprogram/pages/edit/index.wxml`
- Modify: `miniprogram/pages/mine/index.js`
- Modify: `miniprogram/pages/mine/index.wxml`
- Modify: `miniprogram/pages/sync/index.js`
- Modify: `miniprogram/pages/sync/index.wxml`
- Modify: `miniprogram/pages/sync/index.json`
- Modify: `miniprogram/pages/restore/index.js`
- Modify: `miniprogram/pages/restore/index.wxml`
- Modify: `miniprogram/pages/restore/index.json`
- Modify: `tests/pages.test.cjs`
- Modify: `tests/cloud-session.test.cjs`
- Modify: `tests/backup.test.cjs`

**Interfaces:**
- Consumes: workspace `info`, session consent/status/retry/refresh/useRemote/backup`.
- Produces: consumer-facing cloud-first pages with no data-source selection.

- [ ] **Step 1: Write failing page-controller tests**

```js
async function unconsentedPages() {
  const h = await setup(undefined, { consent: false });
  return Object.assign(h, pages(h));
}

async function readyPages() {
  const h = await setup(undefined, { consent: true });
  return Object.assign(h, pages(h));
}

test('first-use page starts only after consent and never creates a local habit', async () => {
  const h = await unconsentedPages();
  const legacyRaw = h.wx.getStorageSync(STORAGE_KEY);
  const today = h.page('today');
  assert.equal(today.data.needsConsent, true);
  today.onDataStart();
  assert.equal(h.navigation.at(-1).url, '/pages/sync/index');
  const sync = h.page('sync');
  await sync.onConsentAndStart();
  assert.equal(h.session.status().ready, true);
  assert.equal(h.wx.getStorageSync(STORAGE_KEY), legacyRaw);
  assert.equal(h.store.read().habits[0].id, 'read');
});

test('sync page exposes status and retry but no source switch or disconnect', async () => {
  const h = await readyPages();
  const sync = h.page('sync');
  assert.equal(sync.data.ready, true);
  await sync.onRetry();
  assert.equal(h.store.info().source, 'cloud');
  assert.equal(sync.onUseCloud, undefined);
  assert.equal(sync.onUseLocal, undefined);
  assert.equal(sync.onDisconnect, undefined);
});
```

Add a simulator-level acceptance list rather than a source-grep test: the rendered screenshots must not contain `本机模式`, `开发测试版`, `开发测试`, `使用云账户`, `返回本机原记录` or `断开连接`.

- [ ] **Step 2: Run tests and verify RED**

```powershell
& $nodeExe --test tests/pages.test.cjs tests/cloud-session.test.cjs tests/backup.test.cjs
```

Expected: FAIL because the current pages expose manual connection and source switching.

- [ ] **Step 3: Implement first-use, loading and unavailable states**

In page data add `needsConsent:false`, `loading:true`, `dataUnavailable:false`, `dataReady:false`. Map `DATA_UNAVAILABLE` in `ui.read` to `{ dataUnavailable:true, dataReady:false }` while preserving the error message. Add `onDataRetry()` to today: set loading, await `getApp().cloudSession.start()`, catch via `ui.error`, and call `refresh()` unless the page was unloaded.

Replace `today/index.wxml` with this complete file; the bottom `storageNotice` button is deliberately absent:

```xml
<import src="../../templates/task.wxml" />
<view class="page">
  <view wx:if="{{needsConsent}}" class="empty">
    <view class="heading">从今天的一小步开始。</view>
    <view class="sub">习惯和打卡记录会安全保存，换手机后仍可找回。</view>
    <button class="primary spaced" bindtap="onDataStart">开始使用</button>
  </view>
  <view wx:elif="{{loading}}" class="empty">
    <view class="section-title">正在读取记录</view>
    <view class="sub">请稍候，不会创建重复数据。</view>
  </view>
  <view wx:elif="{{dataUnavailable}}" class="empty">
    <view class="section-title">暂时无法读取记录</view>
    <view class="sub">{{error || '请检查网络后重试，已有数据不会被清除。'}}</view>
    <button class="primary spaced" bindtap="onDataRetry">重新读取</button>
  </view>
  <block wx:elif="{{dataReady}}">
    <view wx:if="{{error}}" class="error">{{error}}</view>
    <view class="heading">把今天，过好一点。</view>
    <view class="sub">{{dateLabel}}</view>
    <view wx:if="{{!hideQuote}}" class="sub spaced">{{quote}}</view>
    <block wx:if="{{total}}">
      <view class="row between section-title"><text>今日进度</text><text>{{done}} / {{total}}</text></view>
      <view class="meter"><view class="meter-fill" style="width: {{rate}}%"></view></view>
      <view wx:if="{{minimum}}" class="sub spaced">其中 {{minimum}} 项简化完成</view>
      <view wx:if="{{pending.length}}" class="section-title">接下来</view>
      <block wx:for="{{pending}}" wx:key="id"><template is="task" data="{{task: item}}" /></block>
      <view wx:if="{{!pending.length}}" class="notice">今天的安排都记录好了，给自己留一点空闲。</view>
      <button class="text-button spaced" bindtap="onCreate">添加习惯</button>
      <view wx:if="{{completed.length}}" class="section-title">已完成 · {{completed.length}}</view>
      <block wx:for="{{completed}}" wx:key="id"><template is="task" data="{{task: item}}" /></block>
    </block>
    <view wx:else class="empty">
      <view class="heading">{{hasHabits ? '今天没有安排。' : '开始第一件小事。'}}</view>
      <view class="sub">{{hasHabits ? '休息日不算漏做。可以查看习惯安排在哪几天。' : '选一件本来就想做的小事，完成后记录一下。'}}</view>
      <view wx:if="{{!hasHabits}}" class="template-row">
        <button class="template-choice" data-template="read" bindtap="onCreate">读5分钟</button>
        <button class="template-choice" data-template="study" bindtap="onCreate">复习5分钟</button>
        <button class="template-choice" data-template="tidy" bindtap="onCreate">整理3分钟</button>
      </view>
      <button class="primary" bindtap="onCreate">{{hasHabits ? '添加习惯' : '创建第一个习惯'}}</button>
      <button wx:if="{{hasHabits}}" class="text-button spaced" bindtap="onManage">管理我的习惯</button>
    </view>
    <button class="text-button spaced" bindtap="onAssistant">不知道定多大目标？试试计划助手</button>
  </block>
</view>
```

`onDataStart()` navigates to `/pages/sync/index`. Progress/detail/edit must hide record content until `dataReady`; they do not show storage-source copy.

- [ ] **Step 4: Rewrite sync and mine pages around consumer status**

Rename the sync page navigation title and heading to `数据同步`. Before consent render this exact disclosure and one action wired to `onConsentAndStart()` → `acceptConsent(true)`:

```xml
<block wx:if="{{needsConsent}}">
  <view class="section-title">开始前请了解</view>
  <view class="sub">小程序会将习惯名称、目标、执行日期、打卡数量和你填写的备注保存到微信云开发环境，用于同步和换机找回。</view>
  <view class="sub spaced">不会获取手机号、头像、昵称、联系人或位置。你可以在“我的”中导出或清除全部数据。</view>
  <button class="primary spaced" disabled="{{busy}}" loading="{{busy}}" bindtap="onConsentAndStart">同意并开始使用</button>
</block>
```

After consent show only status, last sync time, retry, refresh, backup and conflict adoption. Delete the temporary `connect()` alias and `disconnect()` method from the session after all page/tests use `start()` and `acceptConsent(true)`; neither method appears in the stable interface.

Mine page rows become:

```xml
<button class="setting-row" bindtap="onManage"><text>我的习惯</text><text class="sub">查看与管理</text></button>
<button class="setting-row" bindtap="onSync"><text>数据同步</text><text class="sub">{{syncText}}</text></button>
<button class="setting-row" bindtap="onBackupHub"><text>备份与恢复</text><text class="sub">数据保障</text></button>
<button class="setting-row" bindtap="onExport"><text>导出打卡记录</text><text class="sub">CSV</text></button>
<view class="setting-row"><text>首页短句</text><switch checked="{{!hideQuote}}" color="#245c44" bindchange="onQuote" /></view>
<button class="setting-row" bindtap="onPrivacy">隐私与数据说明</button>
<button class="setting-row danger" bindtap="onDelete">清除全部打卡数据</button>
```

Invert `onQuote` because the new switch means “show” rather than “hide”. Remove the development progress section.

Repurpose the restore page as the backup hub. Delete file-picking and restore callbacks and render these exact actions; `onCloudBackup()` writes `rawBackup()` to `yidian-cloud-sync-backup.json`, while `onLegacyBackup()` writes `legacyBackup()` to `yidian-legacy-backup.json` without changing either store:

```xml
<view class="page">
  <view class="heading">备份与恢复</view>
  <view class="sub spaced">习惯和打卡以云端为准。清理缓存或更换手机后，使用同一微信账号打开即可重新读取。</view>
  <view wx:if="{{error}}" class="error spaced">{{error}}</view>
  <button class="setting-row" disabled="{{busy || !dataReady}}" bindtap="onCloudBackup">
    <text>导出当前备份</text><text class="sub">含待同步记录</text>
  </button>
  <button wx:if="{{hasLegacyData}}" class="setting-row" disabled="{{busy}}" bindtap="onLegacyBackup">
    <text>导出旧版本机记录</text><text class="sub">不会上传或合并</text>
  </button>
  <button wx:if="{{exportPath}}" class="text-button spaced" bindtap="onResend">重新发送备份文件</button>
</view>
```

Do not import a local JSON file into the active cloud account.

- [ ] **Step 5: Run tests, native compilation and simulator acceptance**

```powershell
& $nodeExe --test tests/pages.test.cjs tests/cloud-session.test.cjs tests/backup.test.cjs
& $nodeExe scripts/check.cjs
& $nodeExe scripts/check-native.cjs 'E:\weixinDevTool\微信web开发者工具'
& 'E:\weixinDevTool\微信web开发者工具\wechatide.cmd' -c default simulator_refresh --project 'D:\codex\coding\yidian-miniprogram'
```

Open today, progress, mine, data sync, backup, edit and detail in the native simulator. Capture 390px screenshots and verify: no false empty state, no developer terms, one clear primary action, status text does not wrap into controls, and tab bar remains intact.

- [ ] **Step 6: Create checkpoint B016-T5**

Snapshot every page/test changed by this task plus screenshots and changelog under `20260915-B016-T5-release-ui`; verify hashes.

---

### Task 6: Make deletion cloud-confirmed and preserve anti-revival metadata

**Files:**
- Modify: `miniprogram/services/sync-engine.js`
- Modify: `miniprogram/services/cloud-session.js`
- Modify: `miniprogram/services/workspace-store.js`
- Modify: `miniprogram/pages/mine/index.js`
- Modify: `tests/sync.test.cjs`
- Modify: `tests/cloud-session.test.cjs`
- Modify: `tests/workspace.test.cjs`
- Modify: `tests/pages.test.cjs`

**Interfaces:**
- Consumes: existing server `purge` protocol and idempotent receipts.
- Produces: `engine.purge`, `session.purge`, async workspace clear.

- [ ] **Step 1: Write failing purge tests**

Define the page fixture in `tests/pages.test.cjs` before the tests that call it:

```js
function deletionPage({ clearFails }) {
  const storage = { [STORAGE_KEY]: 'legacy-raw' }, modals = [];
  const files = new Set(['/files/yidian-export.json']);
  let calls = 0;
  const state = ui.domain.emptyState();
  const store = {
    read: () => state,
    contextKey: () => 'cloud:test:0',
    info: () => ({ source: 'cloud', ready: true, phase: 'ready', pending: 0,
      syncText: '数据已同步', lastSyncedAt: '2026-09-15T00:00:00.000Z' }),
    clear: async confirmation => {
      calls += 1;
      assert.equal(confirmation, 'DELETE_MY_DATA');
      if (clearFails) throw Error('云端未确认删除');
      delete storage[STORAGE_KEY];
    }
  };
  global.getApp = () => ({ store, cloudSession: { status: store.info } });
  global.wx = {
    showModal: value => modals.push(value), showToast() {},
    env: { USER_DATA_PATH: '/files' },
    getFileSystemManager: () => ({
      unlinkSync(filePath) {
        if (!files.delete(filePath)) { const error = Error('ENOENT'); error.code = 'ENOENT'; throw error; }
      }
    })
  };
  let definition;
  global.Page = value => { definition = value; };
  const source = path.resolve(__dirname, '../miniprogram/pages/mine/index.js');
  delete require.cache[source];
  require(source);
  const mine = { ...definition, data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch) { Object.assign(this.data, patch); } };
  mine.refresh();
  return { mine, modals, files, storage, clearCalls: () => calls };
}
```

```js
test('purge requires explicit confirmation and saves only the returned empty generation', async () => {
  const f = fixture();
  const snapshot = await f.seed();
  const storage = storageFixture();
  const key = PREFIX + snapshot.accountId;
  const engine = createSyncEngine({ storage, call: event => f.api(event),
    accountId: snapshot.accountId, consent: true, clock: () => f.date,
    newId: () => 'purge-client-op' });
  engine.attach(snapshot);
  storage.setStorageSync(key + ':recovery', 'old-recovery');
  const oldEpoch = snapshot.epoch;
  await assert.rejects(engine.purge(''), /确认/);
  const result = await engine.purge('DELETE_MY_DATA');
  assert.equal(result.state.habits.length, 0);
  assert.equal(result.pending, 0);
  const saved = JSON.parse(storage.getStorageSync(key));
  assert.notEqual(saved.base.epoch, oldEpoch);
  assert.equal(saved.base.state.habits.length, 0);
  assert.equal(storage.getStorageSync(key + ':recovery'), undefined);
});

test('cloud or acknowledgement failure never clears legacy data or exports', async () => {
  const h = deletionPage({ clearFails: true });
  const legacyRaw = h.storage[STORAGE_KEY];
  h.mine.onDelete();
  await h.modals.shift().success({ confirm: true });
  await h.modals.shift().success({ confirm: true });
  assert.equal(h.clearCalls(), 1);
  assert.equal(h.storage[STORAGE_KEY], legacyRaw);
  assert.equal(h.files.has('/files/yidian-export.json'), true);
  assert.match(h.mine.data.error, /未删除/);
});
```

- [ ] **Step 2: Run tests and verify RED**

```powershell
& $nodeExe --test tests/sync.test.cjs tests/cloud-session.test.cjs tests/workspace.test.cjs tests/pages.test.cjs
```

Expected: FAIL because client purge is not implemented and mine deletion is synchronous/local-only.

- [ ] **Step 3: Implement sync-engine purge**

```js
async function purge(confirmation) {
  if (confirmation !== 'DELETE_MY_DATA') throw Error('删除数据需要明确确认');
  if (running) throw Error('正在同步，请等待当前请求完成');
  const envelope = load();
  if (envelope.queue.length || envelope.conflict) throw Error('请先处理待同步操作或冲突');
  const operationId = newId();
  const event = { action: 'purge', operationId, epoch: envelope.base.epoch,
    expectedRevision: envelope.base.revision, operationDate: clock(), confirmation: 'DELETE_MY_DATA' };
  const result = await call(event);
  if (!result || result.ok !== true) throw Error(result && result.message || '云端未确认删除，本机数据未清理');
  validateSnapshot(result);
  if (result.operationId !== operationId || result.appliedRevision !== envelope.base.revision + 1)
    throw Error('云端删除确认无效，本机数据未清理');
  save({ schemaVersion: 1, base: clone(result), queue: [], conflict: null,
    lastError: '', lastSyncedAt: new Date().toISOString() });
  storage.removeStorageSync(key + ':recovery');
  return read();
}
```

Expose `purge` from the engine. Add `removeStorageSync: key => wxApi.removeStorageSync(scope + key)` to the scoped storage wrapper. Session wraps purge in `exclusive`. Add this method to the workspace only in this task:

```js
async clear(confirmation) {
  ready();
  const result = await session.purge(confirmation);
  legacy.clear();
  generation += 1;
  return result;
}
```

- [ ] **Step 4: Make mine deletion async and truthful**

Replace `onDelete()` with the exact two-confirmation flow below. It awaits `ui.store().clear('DELETE_MY_DATA')`; only after resolution does it invalidate export jobs and remove known local export paths. A failed cloud call leaves every file and cache intact.

```js
onDelete() {
  const context = ui.contextKey();
  wx.showModal({ title: '清除全部打卡数据？',
    content: '将删除云端习惯、打卡和备注，并清理本机缓存与导出文件。建议先导出备份。',
    confirmText: '继续', confirmColor: '#983e28',
    success: first => {
      if (!first.confirm) return;
      wx.showModal({ title: '最后确认',
        content: '删除后无法恢复。确认清除全部习惯、备注和打卡记录？',
        confirmText: '确认清除', confirmColor: '#983e28',
        success: async second => {
          if (!second.confirm) return;
          try {
            if (context !== ui.contextKey()) throw Error('数据状态已变化，请重新确认删除');
            await ui.store().clear('DELETE_MY_DATA');
          } catch (_) {
            this.setData({ error: '云端未确认删除，所有数据均已保留' });
            return;
          }
          const pendingPath = this._fileJob && this._fileJob.tempPath;
          this._fileGeneration = (this._fileGeneration || 0) + 1;
          this._fileJob = null;
          const fs = wx.getFileSystemManager();
          let cleanupFailed = false;
          [`${wx.env.USER_DATA_PATH}/yidian-export.csv`,
            `${wx.env.USER_DATA_PATH}/yidian-export.json`,
            `${wx.env.USER_DATA_PATH}/yidian-cloud-sync-backup.json`,
            `${wx.env.USER_DATA_PATH}/yidian-legacy-backup.json`,
            pendingPath].filter(Boolean).forEach(filePath => {
              if (!removeFile(fs, filePath)) cleanupFailed = true;
            });
          this.setData({ exportPath: '', exportName: '',
            error: cleanupFailed ? '云端数据已清除，但一个本机导出文件未能删除，请手动处理。' : '' });
          this.refresh();
          wx.showToast({ title: cleanupFailed ? '数据已清除' : '全部数据已清除', icon: 'none' });
        }
      });
    }
  });
}
```

- [ ] **Step 5: Run purge and full regression tests**

```powershell
& $nodeExe --test tests/sync.test.cjs tests/cloud-session.test.cjs tests/workspace.test.cjs tests/pages.test.cjs
& $nodeExe --test 'tests/*.test.cjs'
```

Expected: PASS; the server-side delete-generation test still proves an old device cannot revive habits.

- [ ] **Step 6: Create checkpoint B016-T6**

Snapshot the four implementation files, four tests and changelog under `20260915-B016-T6-cloud-delete`; verify hashes.

---

### Task 7: Finish local release verification while cloud remains disabled

**Files:**
- Modify: `README.md`
- Modify: `docs/BACKLOG.md`
- Modify: `docs/CLOUD-SYNC.md`
- Modify: `docs/VERIFICATION.md`
- Modify: `docs/CHANGELOG-RELEASE-PREP.md`

**Interfaces:**
- Consumes: all Tasks 1–6 behavior.
- Produces: a deployable but still network-disabled client package and exact evidence.

- [ ] **Step 1: Run all local gates**

```powershell
$node16=(& 'E:\nodejs\npx.cmd' -q -p node@16.13.2 node -p "process.execPath" | Select-Object -Last 1).Trim()
& $node16 --version
& $nodeExe --test 'tests/*.test.cjs'
& $nodeExe scripts/check.cjs
& $nodeExe scripts/build-cloud.cjs --check
& $nodeExe scripts/check-native.cjs 'E:\weixinDevTool\微信web开发者工具'
Get-ChildItem cloudfunctions\habitApi -Recurse -File | Where-Object FullName -NotMatch 'node_modules' | ForEach-Object { & $node16 --check $_.FullName }
```

Expected: the version line is exactly `v16.13.2`, every test/check exits 0, and cloud config is still disabled. `npx` may populate its package cache but does not modify the project dependency manifests.

- [ ] **Step 2: Run simulator flows with cloud mocked/disabled safely**

Verify first-use consent UI, unavailable-cloud error, loading state, ready cached state, daily record, edit failure, pending status, conflict backup and delete failure without real network. Capture the seven screenshots listed in Task 5 and inspect them with `view_image`.

- [ ] **Step 3: Update documentation from verified results only**

Document exact test counts, WXML/WXSS compiler bytes, screenshots, remaining SDK audit findings, disabled cloud flag and unverified real-account items. Do not claim cloud restore or deletion until Task 8 proves them.

- [ ] **Step 4: Create checkpoint B016-local-complete**

Create a full project checkpoint excluding `node_modules`, `.git`, temporary QA crops and exported private records. Verify an explicit manifest of every copied file and its SHA-256.

---

### Task 8: Enable and verify the real test cloud, then flip the client default

**Files:**
- Modify after cloud gates pass: `miniprogram/config/cloud.js`
- Modify after evidence exists: `docs/CLOUD-SYNC.md`
- Modify after evidence exists: `docs/VERIFICATION.md`
- Modify after evidence exists: `docs/CHANGELOG-RELEASE-PREP.md`

**Interfaces:**
- Consumes: deployed `habitApi`, collection `yidian_accounts`, cloud-first client.
- Produces: test-environment cloud-first operation and a release decision.

- [ ] **Step 1: Recheck exact external target without writes**

```powershell
& 'E:\weixinDevTool\微信web开发者工具\wechatide.cmd' -c default cloud_env_list --appid 'wx58e61dffcbfa4249'
& 'E:\weixinDevTool\微信web开发者工具\wechatide.cmd' -c default cloud_fn_info --appid 'wx58e61dffcbfa4249' --env 'cloud1-d4gq76oyt363f08a7' --names 'habitApi'
& 'E:\weixinDevTool\微信web开发者工具\wechatide.cmd' -c default cloud_db_read_struct --appid 'wx58e61dffcbfa4249' --env 'cloud1-d4gq76oyt363f08a7' --action describeCollection --collection-name 'yidian_accounts'
```

Expected: exact AppID/environment, function Active/Nodejs16.13, collection exists with two indexes. Stop on any mismatch.

- [ ] **Step 2: Obtain action-time confirmation and set server flags**

Explain that setting the following environment variables activates cloud reads/writes for calls reaching `habitApi` in `cloud1-d4gq76oyt363f08a7`:

```text
HABIT_APP_ID=wx58e61dffcbfa4249
HABIT_MINIPROGRAM_ONLY=true
HABIT_API_ENABLED=true
```

Use the WeChat Developer Tools function configuration only after confirmation. Do not change database permissions. Re-query function status and call a read probe; stop if SOURCE or APPID is rejected unexpectedly.

- [ ] **Step 3: Obtain write/delete confirmation and run one-account lifecycle**

Use only the synthetic title `上线验收阅读`, no notes. From the simulator: consent, pull, create, complete, clear local Mini Program cache, relaunch and verify restore, then execute the two-confirmation purge. Record revisions and operation IDs without recording OPENID. Confirm the final server snapshot has zero habits/records/notes and a new epoch; the database document remains by design with only anti-revival metadata and the deletion receipt.

- [ ] **Step 4: Verify second-account isolation**

Use a second authorized test WeChat account on another device. Create a different synthetic habit, prove neither account sees the other, then purge the second account after a separate delete confirmation. Never print either OPENID.

- [ ] **Step 5: Flip the client cloud-first flag with TDD protection**

Change only:

```js
module.exports = { enabled: true, envId: 'cloud1-d4gq76oyt363f08a7' };
```

Update the existing brand/config test to expect `enabled:true`; run it once before the change to see the expected failure, make the one-line change, then run the full suite and native compilers.

- [ ] **Step 6: Run native iOS and Android acceptance**

Verify consent, startup loading, cached startup, cache-clear restore, offline record, automatic retry, edit failure, conflict screen, backup, privacy text and cloud-confirmed purge. Record device/WeChat/base-library versions and screenshots; no real personal notes.

- [ ] **Step 7: Create checkpoint B016-cloud-first-verified**

Create a full local checkpoint plus a redacted cloud-state record containing environment ID, function version/time, test actions, revisions, result codes and sanitized document shape. Do not include AppSecret, OPENID, raw request logs or habit notes.

---

### Task 9: Final launch gate and security decision

**Files:**
- Modify: `docs/SDK-SECURITY-REVIEW.md`
- Modify: `docs/VERIFICATION.md`
- Modify: `docs/BACKLOG.md`
- Modify: `docs/CHANGELOG-RELEASE-PREP.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: all local/native/cloud evidence.
- Produces: explicit launch-ready or blocked status, never an optimistic claim.

- [ ] **Step 1: Refresh dependency evidence without automatic fixes**

```powershell
Set-Location 'D:\codex\coding\yidian-miniprogram\cloudfunctions\habitApi'
npm audit --omit=dev --json
npm view wx-server-sdk version
```

Do not run `npm audit fix --force`. Classify each reachable production advisory, current stable SDK availability and mitigation. A remaining reachable high-severity issue blocks launch unless explicitly accepted with a written rationale.

- [ ] **Step 2: Re-run complete verification from a clean DevTools reload**

Run all commands from Task 7, close/reopen only this project window so `app.json` is reloaded, revisit all nine pages, and confirm console contains no application error. Recheck function status and read sanitized cloud documents without changing them.

- [ ] **Step 3: Regenerate the exposed AppSecret outside the codebase**

The user performs secret regeneration in the WeChat admin console. Verify only that the old secret was revoked; never request, display, paste or store the replacement because the current cloud-function identity path does not need it.

- [ ] **Step 4: Publish the final evidence and checkpoint**

Update docs with exact pass counts and remaining limitations. Mark launch-ready only if cloud-first restore, two-account isolation, cloud-confirmed deletion, native iOS/Android checks, privacy configuration and dependency decision all pass. Create `20260915-B016-cloud-first-final` with SHA-256 manifest. Uploading an experience build or submitting review remains a separate user-authorized external action.
