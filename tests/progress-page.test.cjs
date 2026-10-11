'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const domain = require('../miniprogram/core/habits');
const dates = require('../miniprogram/core/date');
const { createCloudSession } = require('../miniprogram/services/cloud-session');
const { createWorkspaceStore } = require('../miniprogram/services/workspace-store');
const SOURCE = path.resolve(__dirname, '../miniprogram/pages/progress/index.js');
const event = dataset => ({ currentTarget: { dataset } });
const jump = value => ({ detail: { value } });
const flush = () => new Promise(setImmediate);
const plan = overrides => ({ title: '读一会儿', target: 10, minimum: 2, unit: '分钟',
  weekdays: [1, 2, 3, 4, 5, 6, 7], time: '', ...overrides });
function create(state, id, day, overrides, startDate = day) {
  return domain.reduce(state || domain.emptyState(), { type: 'create', id, startDate, plan: plan(overrides) }, day);
}
function fixture() {
  let state = create(null, 'read', '2026-09-01');
  for (const day of ['2026-10-05', '2026-10-06', '2026-10-07']) {
    state = domain.reduce(state, { type: 'complete', id: 'read', date: day }, day);
  }
  return state;
}

// Real cloud-session/workspace adapters, with an in-process transport only.
// Device storage is forbidden and no remote function, SDK, or credentials are involved.
async function setup(t, { state = fixture(), today = '2026-10-11', initial = 'ready', getSystemInfoSync } = {}) {
  let currentDay = today;
  const calls = [], navigation = [], timers = [];
  t.mock.method(dates, 'today', () => currentDay);
  t.mock.method(global, 'setInterval', callback => { timers.push(callback); return timers.length; });
  t.mock.method(global, 'clearInterval', () => {});
  const wx = {
    getStorageSync() { throw Error('device storage read forbidden'); },
    setStorageSync() { throw Error('device storage write forbidden'); },
    removeStorageSync() { throw Error('device storage removal forbidden'); },
    navigateTo: value => navigation.push({ type: 'navigateTo', ...value }),
    switchTab: value => navigation.push({ type: 'switchTab', ...value }),
    showToast() { throw Error('read-only progress must not toast a write'); }
  };
  if (getSystemInfoSync) wx.getSystemInfoSync = getSystemInfoSync;
  function memorySession(nextState, accountLetter = 'a') {
    const remote = { state: structuredClone(nextState), error: null, accountId: accountLetter.repeat(64), epoch: 'fixture_' + accountLetter };
    const session = createCloudSession(wx, { enabled: true, envId: 'progress-page-fixture' }, () => async request => {
      calls.push(structuredClone(request));
      if (remote.error) throw remote.error;
      if (request.action !== 'pull') throw Error('fixture transport prohibits writes');
      return { ok: true, accountId: remote.accountId, epoch: remote.epoch,
        revision: remote.state.revision, state: structuredClone(remote.state), serverDate: currentDay };
    });
    return { remote, session, store: createWorkspaceStore(session) };
  }
  let workspace = memorySession(state);
  const app = { store: workspace.store, cloudSession: workspace.session };
  global.wx = wx; global.getApp = () => app;
  if (initial === 'ready') await workspace.session.start();
  if (initial === 'failed') {
    workspace.remote.error = Error('fixture initial read failed');
    await assert.rejects(workspace.session.start(), /fixture initial read failed/);
  }
  let definition;
  global.Page = value => { definition = value; };
  delete require.cache[SOURCE]; require(SOURCE);
  const page = { ...definition, data: structuredClone(definition.data),
    setData(patch, callback) { Object.assign(this.data, patch); if (callback) callback(); } };
  t.after(() => page.onUnload());
  await page.onShow();
  return {
    page, app, calls, navigation, timers, wx,
    get remote() { return workspace.remote; },
    get session() { return workspace.session; },
    setDay(day) { dates.assertDate(day); currentDay = day; },
    async replaceAccount(nextState, { fail = false, start = true } = {}) {
      workspace = memorySession(nextState, 'b');
      app.store = workspace.store; app.cloudSession = workspace.session;
      if (fail) workspace.remote.error = Error('fixture new account read failed');
      if (start) {
        if (fail) await assert.rejects(workspace.session.start(), /fixture new account read failed/);
        else await workspace.session.start();
      }
      return workspace;
    }
  };
}

test('progress page switches three tabs with exact 7/30-day periods and closed statistics', async t => {
  const h = await setup(t), p = h.page;
  assert.equal(p.data.activeTab, 'week'); assert.equal(p.data.days, 7);
  assert.equal(p.data.stats.start, '2026-10-05'); assert.equal(p.data.stats.end, '2026-10-11');
  assert.equal(p.data.rangeLabel, '10月5日 – 10月11日');
  assert.equal(p.data.stats.closed.planned, 6); assert.equal(p.data.stats.closed.done, 3);
  assert.equal(p.data.stats.closed.rate, 50); assert.equal(p.data.stats.todayCell.pending, 1);
  p.onTab(event({ tab: 'month' }));
  assert.equal(p.data.activeTab, 'month'); assert.equal(p.data.days, 30);
  assert.equal(p.data.stats.start, '2026-09-12'); assert.equal(p.data.stats.cells.length, 30);
  p.onCalendar(); assert.equal(p.data.activeTab, 'calendar'); assert.equal(p.data.days, 30);
  p.onTab(event({ tab: 'week' })); assert.equal(p.data.days, 7);
  p.onTab(event({ tab: 'invalid' })); assert.equal(p.data.activeTab, 'week');
});

test('week day selection enters the matching calendar day and survives tab switches', async t => {
  const h = await setup(t), p = h.page;
  p.onDate(event({ date: '2026-10-05' }));
  assert.equal(p.data.activeTab, 'calendar'); assert.equal(p.data.selectedDate, '2026-10-05');
  assert.equal(p.data.visibleMonth, '2026-10'); assert.equal(p.data.selected.date, '2026-10-05');
  assert.equal(p.data.selected.tasks[0].statusText, '原目标打卡');
  p.onTab(event({ tab: 'month' })); p.onTab(event({ tab: 'calendar' }));
  assert.equal(p.data.selectedDate, '2026-10-05');
  p.onDate(event({ date: '2026-10-31' }));
  assert.equal(p.data.selected.isFuture, true); assert.equal(p.data.selected.pending, 0);
  assert.equal(p.data.jumpDate, '2026-10-11');
});

test('picker requires open captures and jumps both month and selected date', async t => {
  const h = await setup(t), p = h.page;
  p.onDateJump(jump('2026-09-17')); assert.equal(p.data.selectedDate, '2026-10-11');
  p.onCalendar(); p.onDateJump(jump('2026-09-17')); assert.equal(p.data.selectedDate, '2026-10-11');
  p.onPickerOpen(); p.onDateJump(jump('2026-09-17'));
  assert.equal(p.data.selectedDate, '2026-09-17'); assert.equal(p.data.visibleMonth, '2026-09');
  assert.equal(p.data.calendar.selectedDate, '2026-09-17'); assert.equal(p._pickerGuard, null);
  p.onPickerOpen(); p.onPickerCancel(); p.onDateJump(jump('2026-10-01'));
  assert.equal(p.data.selectedDate, '2026-09-17');
  p.onCalendarToday(); assert.equal(p.data.selectedDate, '2026-10-11'); assert.equal(p.data.visibleMonth, '2026-10');
});

test('picker cannot accept malformed dates earlier than creation or future dates', async t => {
  const h = await setup(t), p = h.page;
  p.onCalendar();
  for (const date of ['2026-02-30', '2026-08-31', '2026-10-12']) {
    p.onPickerOpen(); p.onDateJump(jump(date)); assert.equal(p.data.selectedDate, '2026-10-11');
  }
  p.onDate(event({ date: '2026-11-01' })); assert.equal(p.data.selectedDate, '2026-10-11');
  p.onDate(event({ date: '2026-08-31' })); assert.equal(p.data.selectedDate, '2026-10-11');
});

for (const expire of ['hide', 'tab', 'month', 'context', 'unload']) {
  test('picker late change is ignored after ' + expire, async t => {
    const h = await setup(t), p = h.page;
    p.onCalendar(); p.onPickerOpen();
    if (expire === 'hide') { p.onHide(); await p.onShow(); }
    if (expire === 'tab') p.onTab(event({ tab: 'month' }));
    if (expire === 'month') p.onMonth(event({ direction: -1 }));
    if (expire === 'context') await h.replaceAccount(domain.emptyState());
    if (expire === 'unload') p.onUnload();
    const before = p.data.selectedDate;
    p.onDateJump(jump('2026-09-17'));
    assert.equal(p.data.selectedDate, before);
    assert.equal(p._pickerGuard, null);
  });
}

test('month buttons clip month ends preserve dates and honor earliest/current boundaries', async t => {
  const h = await setup(t, { state: create(null, 'read', '2026-01-01'), today: '2026-03-31' }), p = h.page;
  p.onCalendar(); p.onMonth(event({ direction: -1 }));
  assert.equal(p.data.selectedDate, '2026-02-28'); assert.equal(p.data.visibleMonth, '2026-02');
  p.onMonth(event({ direction: -1 })); assert.equal(p.data.selectedDate, '2026-01-28');
  p.onMonth(event({ direction: -1 })); assert.equal(p.data.selectedDate, '2026-01-28');
  p.onCalendarToday(); assert.equal(p.data.selectedDate, '2026-03-31');
  p.onMonth(event({ direction: 1 })); assert.equal(p.data.selectedDate, '2026-03-31');
  p.onMonth(event({ direction: 2 })); assert.equal(p.data.selectedDate, '2026-03-31');
});

test('midnight timer follows a selected today and refreshes period and denominator', async t => {
  const h = await setup(t, { state: create(null, 'read', '2026-09-01'), today: '2026-10-31' }), p = h.page;
  p.onCalendar(); assert.equal(p.data.selectedDate, '2026-10-31');
  h.setDay('2026-11-01'); h.timers.at(-1)();
  assert.equal(p.data.todayDate, '2026-11-01'); assert.equal(p.data.selectedDate, '2026-11-01');
  assert.equal(p.data.visibleMonth, '2026-11'); assert.equal(p.data.stats.start, '2026-10-26');
  assert.equal(p.data.stats.closed.cells.at(-1).date, '2026-10-31');
});

test('midnight timer preserves a historical selected date and month', async t => {
  const h = await setup(t, { state: create(null, 'read', '2026-09-01'), today: '2026-10-31' }), p = h.page;
  p.onDate(event({ date: '2026-09-17' }));
  h.setDay('2026-11-01'); h.timers.at(-1)();
  assert.equal(p.data.todayDate, '2026-11-01'); assert.equal(p.data.selectedDate, '2026-09-17');
  assert.equal(p.data.visibleMonth, '2026-09'); assert.equal(p.data.selected.date, '2026-09-17');
});

test('return today refreshes across midnight before the periodic date watcher runs', async t => {
  const h = await setup(t, { state: create(null, 'read', '2026-09-01'), today: '2026-10-31' }), p = h.page;
  p.onDate(event({ date: '2026-09-17' }));
  h.setDay('2026-11-01'); p.onCalendarToday();
  assert.equal(p.data.todayDate, '2026-11-01'); assert.equal(p.data.selectedDate, '2026-11-01');
  assert.equal(p.data.visibleMonth, '2026-11'); assert.equal(p.data.selected.isToday, true);
});

test('cold loading and failed initial read never project an empty account or zero statistics', async t => {
  const h = await setup(t, { initial: 'loading' }), p = h.page;
  assert.equal(p.data.loading, true); assert.equal(p.data.dataReady, false);
  assert.equal(p.data.stats, null); assert.equal(p.data.calendar, null); assert.equal(p.data.selected, null);
  h.remote.error = Error('fixture initial read failed');
  await assert.rejects(h.session.start(), /fixture initial read failed/); await flush();
  assert.equal(p.data.loading, false); assert.equal(p.data.dataUnavailable, true);
  assert.equal(p.data.stats, null); assert.equal(p.data.calendar, null); assert.equal(p.data.selected, null);
  p.onTab(event({ tab: 'month' })); p.onCreate(); p.onToday();
  assert.equal(p.data.activeTab, 'week'); assert.equal(h.navigation.length, 0);
});

test('cloud-confirmed empty account remains distinct from unknown and can open create', async t => {
  const h = await setup(t, { state: domain.emptyState() }), p = h.page;
  assert.equal(p.data.dataReady, true); assert.equal(p.data.dataUnavailable, false);
  assert.equal(p.data.hasHabits, false); assert.equal(p.data.stats.closed.rate, null);
  p.onCreate(); assert.equal(h.navigation[0].url, '/pages/edit/index');
  p.onCalendar(); assert.equal(p.data.selected.habits.length, 0);
});

test('failed refresh retains confirmed memory as read-only and permits date navigation', async t => {
  const h = await setup(t), p = h.page;
  h.remote.error = Error('fixture refresh failed');
  await assert.rejects(h.session.refresh(), /fixture refresh failed/); await flush();
  assert.equal(p.data.dataReady, true); assert.equal(p.data.dataReadOnly, true);
  assert.equal(p.data.stats.done, 3); assert.match(p.data.error, /连接网络/);
  p.onTab(event({ tab: 'month' })); assert.equal(p.data.stats.cells.length, 30);
  p.onDate(event({ date: '2026-09-17' }));
  assert.equal(p.data.selectedDate, '2026-09-17'); assert.equal(p.data.dataReadOnly, true);
  p.onOpen(event({ id: 'read' })); assert.equal(h.navigation.at(-1).url, '/pages/detail/index?id=read');
  assert.ok(h.calls.every(call => call.action === 'pull'));
});

test('uncertain write state cannot fall back to old statistics or zero data', async t => {
  const h = await setup(t), p = h.page;
  // Establish uncertainty outside the page using a transport that rejects all writes.
  await assert.rejects(h.app.store.dispatch({ type: 'settings', hideQuote: true }), /未确认/); await flush();
  assert.equal(h.session.status().pending, 1);
  assert.equal(p.data.pendingConfirm, true); assert.equal(p.data.dataUnavailable, true);
  assert.equal(p.data.stats, null); assert.equal(p.data.calendar, null); assert.equal(p.data.selected, null);
  assert.equal(p.data.recoveryLabel, '重新核对');
  const before = h.calls.length;
  p.onTab(event({ tab: 'calendar' })); p.onToday(); p.onOpen(event({ id: 'read' }));
  assert.equal(h.calls.length, before); assert.equal(h.navigation.length, 0);
});

test('account context switch clears selection and old projections before successful new account read', async t => {
  const h = await setup(t), p = h.page;
  p.onTab(event({ tab: 'month' })); p.onDate(event({ date: '2026-09-17' })); p.onPickerOpen();
  await h.replaceAccount(create(null, 'new_account', '2026-10-11', { title: '新的习惯' }));
  await p.onShow();
  assert.equal(p.data.activeTab, 'week'); assert.equal(p.data.days, 7);
  assert.equal(p.data.selectedDate, '2026-10-11'); assert.equal(p._pickerGuard, null);
  assert.deepEqual(p.data.stats.habits.map(row => row.id), ['new_account']);
  assert.deepEqual(p.data.selected.habits.map(row => row.title), ['新的习惯']);
  assert.equal(p.data.stats.closed.rate, null);
});

test('account context switch with failed new read removes all previous account projections', async t => {
  const h = await setup(t), p = h.page;
  p.onTab(event({ tab: 'month' })); p.onDate(event({ date: '2026-09-17' })); p.onPickerOpen();
  await h.replaceAccount(domain.emptyState(), { fail: true }); await p.onShow();
  assert.equal(p.data.activeTab, 'week'); assert.equal(p.data.days, 7);
  assert.equal(p.data.selectedDate, ''); assert.equal(p.data.visibleMonth, '');
  assert.equal(p.data.stats, null); assert.equal(p.data.calendar, null); assert.equal(p.data.selected, null);
  assert.equal(p.data.advice, ''); assert.equal(p.data.rangeLabel, '');
  assert.equal(p.data.startLabel, '');
  assert.equal(p.data.hasHabits, false); assert.equal(p.data.dataReady, false);
  assert.equal(p.data.dataUnavailable, true); assert.equal(p._pickerGuard, null);
});

test('all relevant and daily habits remain expanded while same names navigate by distinct ids', async t => {
  let state = domain.emptyState();
  for (const [index, id] of ['first', 'second', 'paused', 'archived'].entries()) {
    state = create(state, id, '2026-09-01', { target: 10 + index });
  }
  for (const [id, status] of [['paused', 'paused'], ['archived', 'archived']]) {
    state = domain.reduce(state, { type: 'status', id, status, baseRevision: 1 }, '2026-10-09');
  }
  state = create(state, 'not_started', '2026-10-11', {}, '2026-10-12');
  const h = await setup(t, { state }), p = h.page;
  assert.equal(p.data.stats.habits.length, 5);
  p.onCalendar(); assert.equal(p.data.selected.habits.length, 5);
  assert.equal(p.data.showHabits, undefined); assert.equal(p.onToggleHabits, undefined);
  p.onOpen(event({ id: 'first' })); p.onOpen(event({ id: 'second' }));
  assert.deepEqual(h.navigation.map(item => item.url), ['/pages/detail/index?id=first', '/pages/detail/index?id=second']);
  const markup = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/progress/index.wxml'), 'utf8');
  assert.match(markup, /wx:for="\{\{stats\.habits\}\}"/);
  assert.match(markup, /wx:for="\{\{selected\.habits\}\}"/);
  assert.doesNotMatch(markup, /showHabits|onToggleHabits|showMore|slice\(/);
});

test('progress controls navigate through existing readonly routes without dispatching commands', async t => {
  const h = await setup(t), p = h.page, before = JSON.stringify(h.app.store.read());
  p.onTab(event({ tab: 'month' })); p.onCalendar();
  p.onPickerOpen(); p.onDateJump(jump('2026-09-17'));
  p.onMonth(event({ direction: 1 })); p.onCalendarToday();
  p.onOpen(event({ id: 'read' })); p.onToday(); p.onCreate();
  assert.equal(JSON.stringify(h.app.store.read()), before);
  assert.ok(h.calls.every(call => call.action === 'pull'));
  assert.deepEqual(h.navigation.map(item => item.url), ['/pages/detail/index?id=read', '/pages/today/index', '/pages/edit/index']);
});

test('progress font scaling follows system sizes clamps limits and restores normal size without losing date selection', async t => {
  let size = 24;
  const h = await setup(t, { getSystemInfoSync: () => ({ fontSizeSetting: size }) }), p = h.page;
  assert.equal(p.data.fontScale, 1.5);
  p.onDate(event({ date: '2026-09-17' }));
  for (const [fontSize, scale] of [[32, 2], [48, 2], [12, 1], [16, 1]]) {
    size = fontSize; p.refresh();
    assert.equal(p.data.fontScale, scale);
    assert.equal(p.data.selectedDate, '2026-09-17'); assert.equal(p.data.activeTab, 'calendar');
  }
  assert.ok(h.calls.every(call => call.action === 'pull'));
});

test('progress font scaling falls back for absent API thrown reads and invalid size values', async t => {
  const h = await setup(t), p = h.page;
  assert.equal(p.data.fontScale, 1);
  h.wx.getSystemInfoSync = () => ({ fontSizeSetting: 24 }); p.refresh();
  assert.equal(p.data.fontScale, 1.5);
  h.wx.getSystemInfoSync = () => { throw Error('fixture system info unavailable'); }; p.refresh();
  assert.equal(p.data.fontScale, 1);
  for (const invalid of [undefined, NaN, Infinity, 'invalid']) {
    h.wx.getSystemInfoSync = () => ({ fontSizeSetting: invalid }); p.refresh();
    assert.equal(p.data.fontScale, 1); assert.equal(p.data.dataReady, true);
  }
  delete h.wx.getSystemInfoSync; p.refresh();
  assert.equal(p.data.fontScale, 1); assert.equal(p.data.stats.done, 3);
});
