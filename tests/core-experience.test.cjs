const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const dates = require('../miniprogram/core/date');
const domain = require('../miniprogram/core/habits');
const { advise } = require('../miniprogram/core/progress-advice');
const cloud = require('../miniprogram/config/cloud');
const { APP_NAME } = require('../miniprogram/config/brand');
const { createStore, STORAGE_KEY } = require('./legacy/store.cjs');
const mini = f => fs.readFileSync(path.resolve(__dirname, '../miniprogram', f), 'utf8');
function pageHarness(seedState) {
  const storage = {}, toasts = [];
  const wx = { getStorageSync: k => storage[k], setStorageSync: (k, v) => { storage[k] = v; }, removeStorageSync: k => { delete storage[k]; },
    showToast: o => toasts.push(o), showModal() {}, navigateTo() {}, navigateBack() {} };
  const store = createStore(wx);
  if (seedState) storage[STORAGE_KEY] = JSON.stringify(seedState);
  global.wx = wx; global.getApp = () => ({ store });
  return { storage, toasts, store };
}
function loadPage(name, options = {}) {
  let definition; global.Page = v => { definition = v; };
  const source = path.resolve(__dirname, '../miniprogram/pages/' + name + '/index.js');
  delete require.cache[source]; require(source);
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)), setData(patch) { Object.assign(this.data, patch); } };
  if (page.onLoad) page.onLoad(options);
  page.refresh();
  return page;
}

test('short date labels match full labels without the weekday', () => {
  assert.equal(dates.shortLabel('2026-09-24'), '9月24日');
  assert.equal(dates.shortLabel('2026-10-03'), '10月3日');
  assert.match(dates.label('2026-09-24'), /^9月24日 周四$/);
  assert.throws(() => dates.shortLabel('2026-9-24'));
});

test('progress advice only uses plan and completion counts', () => {
  assert.equal(advise(null), null);
  assert.equal(advise({ planned: 0, standard: 0, minimum: 0, done: 0, cells: [] }), null);
  assert.equal(advise({ planned: 2, standard: 2, minimum: 0, done: 2, cells: [{ planned: 2 }, { planned: 0 }] }), null);
  const cells = Array.from({ length: 5 }, () => ({ planned: 2 }));
  assert.match(advise({ planned: 10, standard: 7, minimum: 1, done: 8, cells }), /保持这个节奏/);
  assert.match(advise({ planned: 10, standard: 3, minimum: 3, done: 6, cells }), /先按这个节奏保持一周/);
  assert.match(advise({ planned: 10, standard: 1, minimum: 1, done: 2, cells }), /缩小一档/);
  assert.match(advise({ planned: 10, standard: 5, minimum: 1, done: 6, cells }), /继续现在的节奏/);
  const text = advise({ planned: 10, standard: 7, minimum: 1, done: 8, cells });
  assert.doesNotMatch(text, /时段|晚上|早上/);
});

test('progress page formats the range and derives advice from real records', () => {
  const today = dates.today(), start = dates.shift(today, -6);
  const plan = { title: '读书', target: 5, minimum: 2, unit: '分钟', time: '', weekdays: [1, 2, 3, 4, 5, 6, 7] };
  let state = domain.reduce(domain.emptyState(), { type: 'create', id: 'read', startDate: start, plan }, start);
  for (let i = 5; i >= 1; i--) { const day = dates.shift(today, -i); state = domain.reduce(state, { type: 'complete', id: 'read', date: day }, day); }
  pageHarness(state);
  const page = loadPage('progress');
  assert.equal(page.data.rangeLabel, dates.shortLabel(page.data.stats.start) + ' – ' + dates.shortLabel(page.data.stats.end));
  assert.match(page.data.rangeLabel, /^\d+月\d+日 – \d+月\d+日$/);
  assert.match(page.data.advice, /保持这个节奏/);
  assert.equal(page.data.stats.planned, 7);
  assert.equal(page.data.stats.standard, 5);
});

test('progress empty state offers creation without calendar scaffolding', () => {
  pageHarness(domain.emptyState());
  const page = loadPage('progress');
  assert.equal(page.data.stats.planned, 0);
  assert.equal(page.data.advice, '');
  const markup = mini('pages/progress/index.wxml');
  assert.match(markup, /这段时间还没有安排/);
  assert.match(markup, /bindtap="onCreate">创建习惯/);
  assert.match(markup, /<view wx:else class="empty">/);
  assert.match(markup, /legend-mark rest/);
  assert.match(markup, /未记录/);
});

test('first-run empty state exposes value, dual-tier templates and a single helper', () => {
  const markup = mini('pages/today/index.wxml');
  assert.match(markup, /再忙，也能做一点/);
  for (const tpl of ['read', 'walk', 'study', 'tidy']) assert.match(markup, new RegExp('data-template="' + tpl + '"'));
  assert.match(markup, /自己填写/);
  assert.match(markup, /不知道定多大？/);
  assert.match(markup, /帮我定个小目标/);
  assert.match(markup, /<button wx:if="\{\{hasHabits\}\}" class="add-button"/);
  assert.match(markup, /skeleton skeleton-card/);
  assert.match(markup, /暂时读不到云端记录/);
  const task = mini('templates/task.wxml');
  assert.match(task, /check-pill/);
  assert.match(task, /chip-lime/);
  assert.match(task, /忙时完成/);
  assert.match(task, /按忙时目标打卡/);
  const wxss = mini('app.wxss').toLowerCase();
  for (const token of ['#f6f8f5', '#ddf3a4', '.card {', '.check-pill', '.soft-button', '.stamp-in', '.skeleton']) assert.ok(wxss.includes(token), token);
});

test('busy-goal one-tap switch is enabled for both targets', () => {
  assert.equal(cloud.TARGETS.test.completeMinimumEnabled, true);
  assert.equal(cloud.TARGETS.product.completeMinimumEnabled, true);
  assert.equal(cloud.completeMinimumEnabled, true);
  assert.equal(cloud.functionName, 'jiancheng_daka_api');
});

test('cloud status naming and tab navigation titles stay consistent', () => {
  assert.equal(JSON.parse(mini('pages/sync/index.json')).navigationBarTitleText, '云端状态');
  assert.match(mini('pages/sync/index.wxml'), /云端状态/);
  for (const name of ['progress', 'mine']) assert.equal(JSON.parse(mini('pages/' + name + '/index.json')).navigationBarTitleText, APP_NAME);
});

test('user-visible legacy wording is gone from active pages', () => {
  const files = ['templates/task.wxml', 'pages/today/index.wxml', 'pages/progress/index.wxml', 'pages/progress/index.js', 'pages/edit/index.wxml', 'pages/edit/index.js',
    'pages/mine/index.wxml', 'pages/mine/index.js', 'pages/assistant/index.wxml', 'pages/detail/index.wxml', 'pages/manage/index.wxml', 'pages/data/index.wxml',
    'pages/sync/index.wxml', 'services/ui.js', 'core/habits.js'];
  for (const file of files) {
    const source = mini(file);
    for (const term of ['简化', '小目标完成', '数据同步', '已保存到云端']) assert.ok(!source.includes(term), file + ' still contains ' + term);
  }
});
