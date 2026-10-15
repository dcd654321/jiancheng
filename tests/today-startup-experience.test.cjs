const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const domain = require('../miniprogram/core/habits');

function clockFor(t) {
  let now = 1700000000000, serial = 0;
  const timers = new Map();
  const set = (callback, delay) => { const id = ++serial; timers.set(id, { callback, at: now + delay }); return id; };
  t.mock.method(Date, 'now', () => now);
  t.mock.method(global, 'setTimeout', set);
  t.mock.method(global, 'clearTimeout', id => timers.delete(id));
  // Day rollover is unrelated to the read feedback and must not use a real timer.
  t.mock.method(global, 'setInterval', () => ++serial);
  t.mock.method(global, 'clearInterval', () => {});
  return { now: () => now, timers,
    advance(ms) {
      const end = now + ms;
      while (true) {
        const due = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        now = due[1].at; timers.delete(due[0]); due[1].callback();
      }
      now = end;
    }
  };
}

function setup(t) {
  const clock = clockFor(t), listeners = new Set();
  let confirmed = false, retryResolve, retryReject;
  const state = domain.emptyState();
  const status = { ready: false, phase: 'loading', busy: true, pending: 0, lastAttemptAt: clock.now(), lastError: '', lastErrorCode: '' };
  const session = { status: () => ({ ...status }),
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    start() {
      Object.assign(status, { phase: 'loading', busy: true, ready: false, lastAttemptAt: clock.now(), lastError: '', lastErrorCode: '' });
      listeners.forEach(fn => fn());
      return new Promise((resolve, reject) => { retryResolve = resolve; retryReject = reject; });
    }
  };
  const app = { cloudSession: session, store: {
    contextKey: () => 'fixture-account',
    info: () => ({ source: 'cloud', ...status }),
    stale: () => confirmed ? structuredClone(state) : null,
    read() {
      if (status.ready) return structuredClone(state);
      const error = Error(status.lastError || '正在读取云端记录');
      error.code = status.phase === 'loading' ? 'DATA_LOADING' : 'DATA_UNAVAILABLE';
      error.causeCode = status.lastErrorCode;
      throw error;
    }
  } };
  const before = { getApp: global.getApp, wx: global.wx, Page: global.Page };
  global.getApp = () => app; global.wx = {};
  let definition; global.Page = value => { definition = value; };
  const source = path.resolve(__dirname, '../miniprogram/pages/today/index.js');
  delete require.cache[source]; require(source);
  const page = { ...definition, updates: [], data: structuredClone(definition.data),
    // Existing page fixtures use a one-argument setData as well.
    setData(patch) { this.updates.push(patch); Object.assign(this.data, patch); }
  };
  t.after(() => { page.onUnload(); Object.assign(global, before); });
  const notify = () => listeners.forEach(fn => fn());
  return { page, clock, status, app,
    succeed() { confirmed = true; Object.assign(status, { ready: true, busy: false, phase: 'ready', lastError: '', lastErrorCode: '' }); notify(); if (retryResolve) retryResolve(); },
    fail(code = 'NETWORK_ERROR', pending = 0) {
      Object.assign(status, { ready: false, busy: false, phase: 'offline', pending, lastError: 'fixture read failed', lastErrorCode: code });
      notify(); if (retryReject) { const error = Error(status.lastError); error.code = code; retryReject(error); }
    }
  };
}

test('Today shows short feedback at 300 ms and slow feedback at 3 seconds without restarting on repeated reads', t => {
  const { page, clock } = setup(t); page.onShow();
  assert.equal(page.data.loading, true); assert.equal(page.data.startupLoadingText, '');
  clock.advance(299); assert.equal(page.data.startupLoadingText, '');
  clock.advance(1); assert.equal(page.data.startupLoadingText, '正在读取今日习惯');
  clock.advance(700); page.refresh();
  clock.advance(1999); assert.equal(page.data.startupLoadingText, '正在读取今日习惯');
  clock.advance(1); assert.equal(page.data.startupLoadingText, '连接有些慢，正在读取今日习惯');
});

test('a successful read removes feedback immediately and cancels every pending feedback callback', t => {
  const h = setup(t); h.page.onShow();
  const callbacks = [...h.clock.timers.values()].map(timer => timer.callback);
  h.clock.advance(200); h.succeed();
  assert.equal(h.page.data.dataReady, true); assert.equal(h.page.data.loading, false);
  assert.equal(h.page.data.startupLoadingText, ''); assert.equal(h.clock.timers.size, 0);
  const updates = h.page.updates.length;
  callbacks.forEach(callback => callback()); h.clock.advance(5000);
  assert.equal(h.page.updates.length, updates);
});

for (const code of ['CLOUD_READ_TIMEOUT', 'CLOUD_INIT_TIMEOUT']) test(code + ': initial timeout keeps recovery and uses the habit-specific title', t => {
  const h = setup(t); h.page.onShow(); h.clock.advance(3000); h.fail(code);
  assert.equal(h.page.data.loading, false); assert.equal(h.page.data.dataUnavailable, true);
  assert.equal(h.page.data.startupUnavailableTitle, '暂时没能读取习惯');
  assert.equal(h.page.data.recoveryLabel, '重新读取');
  assert.equal(h.page.data.startupLoadingText, ''); assert.equal(h.clock.timers.size, 0);
});

test('ordinary errors and unconfirmed writes keep their existing recovery meaning', t => {
  const h = setup(t); h.page.onShow(); h.fail('NETWORK_ERROR');
  assert.equal(h.page.data.startupUnavailableTitle, ''); assert.match(h.page.data.error, /fixture read failed/);
  h.fail('CLOUD_READ_TIMEOUT', 1);
  assert.equal(h.page.data.startupUnavailableTitle, ''); assert.equal(h.page.data.recoveryLabel, '重新核对');
  assert.match(h.page.data.error, /正在核对这次记录/);
});

for (const method of ['onHide', 'onUnload']) test(method + ': expired callbacks cannot update the page', t => {
  const h = setup(t); h.page.onShow();
  const callbacks = [...h.clock.timers.values()].map(timer => timer.callback);
  h.page[method](); const updates = h.page.updates.length;
  assert.equal(h.clock.timers.size, 0);
  h.clock.advance(5000); callbacks.forEach(callback => callback()); h.succeed();
  assert.equal(h.page.updates.length, updates);
});

test('returning during the same read aligns feedback to the request and ignores callbacks from the previous visit', t => {
  const h = setup(t); h.page.onShow();
  const oldCallbacks = [...h.clock.timers.values()].map(timer => timer.callback);
  h.page.onHide(); h.clock.advance(3100); h.page.onShow();
  assert.equal(h.page.data.startupLoadingText, '连接有些慢，正在读取今日习惯');
  const updates = h.page.updates.length; oldCallbacks.forEach(callback => callback());
  assert.equal(h.page.updates.length, updates);
});

test('explicit retry starts a fresh feedback window and recovers in place', async t => {
  const h = setup(t); h.page.onShow(); h.clock.advance(8000); h.fail('CLOUD_READ_TIMEOUT');
  const retry = h.page.onDataRetry();
  assert.equal(h.page.data.loading, true); assert.equal(h.page.data.startupLoadingText, '');
  assert.equal(h.page.data.startupUnavailableTitle, '');
  h.clock.advance(300); assert.equal(h.page.data.startupLoadingText, '正在读取今日习惯');
  h.succeed(); await retry;
  assert.equal(h.page.data.dataReady, true); assert.equal(h.page.data.loading, false);
  assert.equal(h.page.data.startupLoadingText, ''); assert.equal(h.clock.timers.size, 0);
});

test('a failed retry clears feedback timers and leaves the retry action available', async t => {
  const h = setup(t); h.page.onShow(); h.fail('NETWORK_ERROR');
  h.clock.advance(1000); const retry = h.page.onDataRetry(); h.clock.advance(3000); h.fail('CLOUD_READ_TIMEOUT'); await retry;
  assert.equal(h.page.data.startupLoadingText, ''); assert.equal(h.clock.timers.size, 0);
  assert.equal(h.page.data.dataUnavailable, true); assert.equal(h.page._retrying, false);
  assert.equal(h.page.data.startupUnavailableTitle, '暂时没能读取习惯');
});

test('confirmed memory stays visible during a background refresh and never starts skeleton timers', t => {
  const h = setup(t); h.succeed(); h.page.onShow();
  Object.assign(h.status, { busy: true }); h.page.refresh();
  assert.equal(h.page.data.dataReady, true); assert.equal(h.page.data.loading, false);
  assert.equal(h.page.data.readRefreshing, true); assert.equal(h.clock.timers.size, 0);
  h.succeed(); assert.equal(h.page.data.readRefreshing, false);
});

test('Today skeleton is decorative, has two compact cards, and supports reduced motion', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/today/index.wxml'), 'utf8');
  const loading = source.slice(source.indexOf('<view wx:if="{{loading}}"'), source.indexOf('<view wx:elif="{{dataUnavailable}}"'));
  assert.match(loading, /aria-hidden="true"/); assert.equal((loading.match(/class="skeleton-card"/g) || []).length, 2);
  assert.doesNotMatch(loading, /<button|bindtap|{{total}}|{{done}}/);
  assert.match(loading, /role="status"/);
  const style = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/today/index.wxss'), 'utf8');
  assert.match(style, /prefers-reduced-motion:\s*reduce/);
});
