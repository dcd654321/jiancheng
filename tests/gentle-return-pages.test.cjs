const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const dates = require('../miniprogram/core/date');
const domain = require('../miniprogram/core/habits');
const { createStore, STORAGE_KEY } = require('../miniprogram/services/store');

const event = (id, date) => ({ currentTarget: { dataset: { id, date, done: false } } });
const allDays = [1, 2, 3, 4, 5, 6, 7];
function harness(t, plans) {
  const storage = {}, modals = [], toasts = [], navigation = [];
  const wx = {
    getStorageSync: key => storage[key], setStorageSync: (key, value) => { storage[key] = value; },
    showModal: options => modals.push(options), showToast: options => toasts.push(options),
    navigateTo: options => navigation.push(options.url)
  };
  const store = createStore(wx), app = { store };
  global.wx = wx; global.getApp = () => app;
  const today = dates.today(), start = dates.shift(today, -5);
  let state = domain.emptyState();
  for (const [id, partial] of plans) {
    const plan = { title: id, target: 5, minimum: 2, unit: '分钟', time: '', weekdays: allDays, ...partial };
    state = domain.reduce(state, { type: 'create', id, startDate: start, plan }, start);
  }
  storage[STORAGE_KEY] = JSON.stringify(state);
  let definition;
  global.Page = value => { definition = value; };
  const source = path.resolve(__dirname, '../miniprogram/pages/today/index.js');
  delete require.cache[source]; require(source);
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)), setData(patch) { Object.assign(this.data, patch); } };
  page.refresh();
  t.after(() => { if (page.onUnload) page.onUnload(); });
  return { page, store, app, storage, modals, toasts, navigation, today };
}

test('today shows at most one gentle return and original action only guides, without historical writes', t => {
  const h = harness(t, [['read', {}], ['walk', {}]]);
  const before = h.store.rawBackup();
  assert.equal(h.page.data.returnGuide.id, h.page.data.pending[0].id);
  h.page.onReturnOriginal(event(h.page.data.returnGuide.id, h.today));
  assert.equal(h.store.rawBackup(), before);
  assert.deepEqual(h.navigation, ['/pages/detail/index?id=' + h.page.data.returnGuide.id]);
  assert.equal(h.page.data.done, 0);
});

test('smaller target reuses confirmation and does not complete or fill missed days; original restores today', t => {
  const h = harness(t, [['read', { minimum: null }]]);
  const beforeRecords = h.store.read().records;
  h.page.onReturnSmall(event('read', h.today));
  assert.equal(h.modals.at(-1).content, '');
  h.modals.pop().success({ confirm: true, content: '2' });
  assert.equal(h.page.data.pending[0].target, 2);
  assert.equal(h.page.data.pending[0].done, false);
  assert.equal(h.page.data.returnGuide.simplified, true);
  assert.deepEqual(Object.keys(h.store.read().records), [`read@${h.today}`]);
  assert.deepEqual(beforeRecords, {});
  h.page.onReturnOriginal(event('read', h.today));
  assert.equal(h.page.data.pending[0].target, 5);
  assert.equal(h.page.data.done, 0);
  assert.deepEqual(Object.keys(h.store.read().records), [`read@${h.today}`]);
});

test('a target of one has no smaller action', t => {
  const h = harness(t, [['water', { target: 1, minimum: null, unit: '次' }]]);
  assert.equal(h.page.data.returnGuide.originalTarget, 1);
  h.page.onReturnSmall(event('water', h.today));
  assert.equal(h.modals.length, 0);
  const before = h.store.rawBackup();
  h.page.onReturnOriginal(event('water', h.today));
  assert.equal(h.store.rawBackup(), before);
});

test('today without an arranged task does not display a return prompt', t => {
  const todayWeekday = dates.weekday(dates.today());
  const weekdays = allDays.filter(day => day !== todayWeekday);
  const h = harness(t, [['read', { weekdays }]]);
  assert.equal(h.page.data.total, 0);
  assert.equal(h.page.data.returnGuide, null);
});

test('completion removes prompt, uses gentle feedback, and pending sync remains truthful', t => {
  const h = harness(t, [['read', {}]]);
  const doneDay = dates.shift(h.today, -4);
  const state = domain.reduce(h.store.read(), { type: 'complete', id: 'read', date: doneDay }, doneDay);
  h.storage[STORAGE_KEY] = JSON.stringify(state);
  h.page.refresh();
  assert.equal(h.page.data.returnGuide.id, 'read');
  h.page.onComplete(event('read', h.today));
  assert.equal(h.page.data.returnGuide, null);
  assert.equal(h.page.data.done, 1);
  assert.equal(h.toasts.at(-1).title, '今天继续了');

  const pending = harness(t, [['read', {}]]);
  pending.storage[STORAGE_KEY] = JSON.stringify(domain.reduce(pending.store.read(),
    { type: 'complete', id: 'read', date: dates.shift(pending.today, -4) }, dates.shift(pending.today, -4)));
  let syncPending = false;
  pending.store.info = () => ({ pending: syncPending ? 1 : 0, syncAttention: syncPending, syncText: '等待同步' });
  const dispatch = pending.store.dispatch;
  pending.store.dispatch = command => { const result = dispatch(command); syncPending = true; return result; };
  pending.page.refresh();
  pending.page.onComplete(event('read', pending.today));
  assert.equal(pending.page.data.returnGuide, null);
  assert.equal(pending.page.data.syncAttention, true);
  assert.equal(pending.toasts.at(-1).title, '今天继续了，待同步');
});

test('sync warning, conflict, unreadable data and account replacement never leave stale return prompt', t => {
  const h = harness(t, [['read', {}]]);
  assert.equal(h.page.data.returnGuide.id, 'read');
  h.store.info = () => ({ pending: 1, syncAttention: true, syncText: '有记录待同步' });
  h.page.refresh();
  assert.equal(h.page.data.returnGuide, null);
  assert.equal(h.page.data.syncAttention, true);
  h.store.info = () => ({ conflict: { id: 'x' }, syncAttention: true, syncText: '需要处理冲突' });
  h.page.refresh();
  assert.equal(h.page.data.returnGuide, null);
  h.app.store = { read() { const err = Error('暂时无法读取'); err.code = 'DATA_UNAVAILABLE'; throw err; }, info: () => ({}) };
  h.page.refresh();
  assert.equal(h.page.data.dataReady, false);
  assert.equal(h.page.data.dataUnavailable, true);
  h.app.store = { read: () => domain.emptyState(), info: () => ({}), contextKey: () => 'other-account' };
  h.page.refresh();
  assert.equal(h.page.data.returnGuide, null);
});

test('failed completion does not report success or remove the return state', t => {
  const h = harness(t, [['read', {}]]);
  h.store.dispatch = () => { throw Error('保存失败'); };
  const before = h.store.rawBackup();
  h.page.onComplete(event('read', h.today));
  assert.equal(h.store.rawBackup(), before);
  assert.equal(h.page.data.returnGuide.id, 'read');
  assert.equal(h.toasts.length, 0);
  assert.match(h.page.data.error, /保存失败/);
});

test('native markup provides one conditional prompt and hides invalid smaller action', () => {
  const root = path.resolve(__dirname, '../miniprogram');
  const markup = fs.readFileSync(path.join(root, 'pages/today/index.wxml'), 'utf8');
  assert.match(markup, /wx:if="\{\{returnGuide\}\}"/);
  assert.match(markup, /wx:if="\{\{returnGuide\.originalTarget > 1\}\}"/);
  assert.match(markup, /bindtap="onReturnOriginal"/);
  assert.match(markup, /bindtap="onReturnSmall"/);
  assert.match(markup, /过去不用补打卡/);
});
