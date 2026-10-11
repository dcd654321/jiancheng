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
  const standard = advise({ planned: 10, standard: 7, minimum: 1, done: 8, cells });
  assert.match(standard, /按原目标记录了 7 次/);
  assert.match(standard, /可以先照这个节奏继续/);
  const busy = advise({ planned: 10, standard: 3, minimum: 3, done: 6, cells });
  assert.match(busy, /其中 3 次选择忙时目标/);
  assert.match(busy, /忙的时候可以继续用它/);
  const low = advise({ planned: 10, standard: 1, minimum: 1, done: 2, cells });
  assert.match(low, /如果最近安排偏满/);
  assert.match(low, /调整目标或天数/);
  const neutral = advise({ planned: 10, standard: 5, minimum: 1, done: 6, cells });
  assert.match(neutral, /按现在的安排继续/);
  const text = advise({ planned: 10, standard: 7, minimum: 1, done: 8, cells });
  assert.doesNotMatch(text, /时段|晚上|早上|自律|适合你/);
  for (const value of [standard, busy, low, neutral]) assert.match(value, /安排 10 次、记录 \d+ 次/, '先给同一周期的事实计数');
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
  assert.match(page.data.advice, /按原目标记录了 5 次/);
  assert.equal(page.data.stats.planned, 7);
  assert.equal(page.data.stats.standard, 5);
});

test('progress empty state offers creation without calendar scaffolding', () => {
  pageHarness(domain.emptyState());
  const page = loadPage('progress');
  assert.equal(page.data.stats.planned, 0);
  assert.equal(page.data.advice, '');
  const markup = mini('pages/progress/index.wxml');
  assert.match(markup, /第一次打卡后，进展就会出现在这里/);
  assert.match(markup, /bindtap="onCreate">创建习惯/);
  assert.match(markup, /bindtap="onToday">回今日看看/);
  assert.match(markup, /<view wx:else class="empty">/);
  assert.match(markup, /legend-mark rest/);
  assert.match(markup, /未打卡/);
});

test('cold start opens today directly and shows a brief reading state without a welcome screen', () => {
  const markup = mini('pages/today/index.wxml');
  const loading = markup.match(/<view wx:if="\{\{loading\}\}"[\s\S]*?(?=<view wx:elif="\{\{dataUnavailable\}\}")/);
  assert.ok(loading, '等待、读取失败和账户就绪仍是不同状态');
  assert.match(loading[0], /正在读取/);
  assert.doesNotMatch(loading[0], /loadingGreeting|loadingNote|loading-hero|loading-bars|loading-example|bindtap="onCreate"|bindtap="onAssistant"/);
  assert.match(markup, /wx:elif="\{\{dataReady\}\}"/);
  assert.match(markup, /暂时没能读取记录/);
  assert.match(markup, /bindtap="onDataRetry"/);
  assert.equal((markup.match(/heading heading-xl">今日<\/view>/g) || []).length, 1);
  assert.ok(markup.indexOf('<view class="page-header">') < markup.indexOf('wx:if="{{loading}}"'), '今日标题直接显示，不等待读取完成');
  assert.equal(JSON.parse(mini('app.json')).pages[0], 'pages/today/index');
  assert.doesNotMatch(mini('pages/today/index.js'), /LOADING_NOTES|loadingGreeting|loadingNote/);
  assert.doesNotMatch(mini('pages/today/index.wxss'), /loading-bars|@keyframes bar-grow/);
});
test('today empty state centers one add entry and retains existing task lists', () => {
  const markup = mini('pages/today/index.wxml');
  const empty = markup.match(/<view wx:else class="today-empty">([\s\S]*?)<\/view>/);
  assert.ok(empty, '零项安排使用统一空态，不区分首次账户和已有习惯的休息日');
  assert.equal((empty[1].match(/<button\b/g) || []).length, 1);
  assert.match(empty[1], /disabled="\{\{dataReadOnly\}\}" data-template="" bindtap="onCreate">添加习惯<\/button>/);
  assert.doesNotMatch(empty[1], /模板|推荐|整理|onAssistant|onToggleChooser|onManage/);
  assert.match(markup, /<block wx:if="\{\{total\}\}">[\s\S]*wx:for="\{\{pending\}\}"[\s\S]*wx:for="\{\{completed\}\}"[\s\S]*<\/block>\s*<view wx:else class="today-empty">/);
  assert.match(markup, /<button wx:if="\{\{dataReady && total\}\}" class="add-button"/);
  assert.match(markup, /wx:if="\{\{total && chooserOpen\}\}"/);
  assert.match(markup, /wx:if="\{\{total && !pending.length && tomorrow\}\}"/);
  assert.doesNotMatch(markup, /hero-title|starterTemplate|starter-options|忙的时候，也能做一点/);
  const pageStyle = mini('pages/today/index.wxss');
  assert.match(pageStyle, /\.today-empty\s*\{[^}]*align-items:\s*center[^}]*justify-content:\s*center/);
});

test('task controls keep their recording labels and shared theme styling', () => {
  const task = mini('templates/task.wxml');
  assert.match(task, /check-pill/);
  assert.match(task, /chip-lime/);
  assert.match(task, /本次打卡/);
  assert.match(task, /record-action-goal">忙时 {{task.minimum}}{{task.unit}}/);
  assert.match(task, /record-action-label">打卡/);
  const wxss = mini('app.wxss').toLowerCase();
  for (const token of ['#f6f7f2', '#edf2e3', '.card {', '.check-pill', '.soft-button', '.stamp-in', '.skeleton']) assert.ok(wxss.includes(token), token);
  assert.ok(wxss.includes('@import "styles/theme.wxss"'), 'app.wxss 引入主题作用域');
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
    'pages/mine/index.wxml', 'pages/mine/index.js', 'pages/detail/index.wxml', 'pages/manage/index.wxml', 'pages/data/index.wxml',
    'pages/sync/index.wxml', 'services/ui.js', 'core/habits.js'];
  for (const file of files) {
    const source = mini(file);
    for (const term of ['简化', '小目标完成', '数据同步', '已保存到云端']) assert.ok(!source.includes(term), file + ' still contains ' + term);
  }
});
