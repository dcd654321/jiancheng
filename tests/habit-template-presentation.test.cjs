const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { HABIT_TEMPLATES, getHabitTemplate, templatePlan } = require('../miniprogram/config/habit-templates');
const domain = require('../miniprogram/core/habits');
const dates = require('../miniprogram/core/date');
const { createStore, STORAGE_KEY } = require('./legacy/store.cjs');

function harness(t, state = domain.emptyState(), fontSizeSetting = 16) {
  const storage = { [STORAGE_KEY]: JSON.stringify(state) };
  const wx = {
    getStorageSync: key => storage[key], setStorageSync: (key, value) => { storage[key] = value; },
    removeStorageSync: key => { delete storage[key]; },
    getSystemInfoSync: () => ({ fontSizeSetting }), setNavigationBarTitle() {},
    showToast() {}, showModal() {}, switchTab() {}, navigateTo() {}, navigateBack() {}
  };
  const app = { store: createStore(wx) }, pages = [];
  global.wx = wx; global.getApp = () => app;
  t.after(() => pages.forEach(page => page.onUnload && page.onUnload()));
  function page(name, options = {}) {
    let definition;
    global.Page = value => { definition = value; };
    const file = path.resolve(__dirname, '../miniprogram/pages', name, 'index.js');
    delete require.cache[file]; require(file);
    const result = { ...definition, data: structuredClone(definition.data),
      setData(patch, callback) { Object.assign(this.data, patch); if (callback) callback(); } };
    pages.push(result);
    if (result.onLoad) result.onLoad(options);
    if (result.refresh) result.refresh();
    return result;
  }
  return { wx, app, page };
}

test('today, new forms and theme examples use the same four practical default goals', t => {
  const h = harness(t), today = h.page('today'), appearance = h.page('appearance');
  assert.deepEqual(today.data.templates.map(item => [item.key, item.target, item.minimum]),
    [['read', 30, 10], ['walk', 30, 10], ['study', 30, 10], ['tidy', 15, 5]]);
  assert.deepEqual(appearance.data.exampleTemplate, getHabitTemplate('read'));
  for (const item of HABIT_TEMPLATES) {
    const form = h.page('edit', { template: item.key });
    assert.equal(form.data.compact, true);
    assert.deepEqual(domain.validatePlan(form.data), {
      title: item.title, target: item.target, minimum: item.minimum, unit: '分钟',
      weekdays: [1, 2, 3, 4, 5, 6, 7], time: ''
    });
  }
  assert.equal(h.app.store.read().habits.length, 0, 'opening a template never creates a habit');
});

test('empty accounts and rest days offer add while pending and completed days keep their task lists', t => {
  const day = dates.today();
  const create = weekdays => domain.reduce(domain.emptyState(), { type: 'create', id: 'read', startDate: day,
    plan: { ...templatePlan('read'), weekdays, time: '' } }, day);
  const pending = create([1, 2, 3, 4, 5, 6, 7]);
  const cases = [
    ['首次空账户', domain.emptyState(), false, 0, 0, 0],
    ['已有习惯但今天无安排', create([dates.weekday(day) % 7 + 1]), true, 0, 0, 0],
    ['已有待做但尚未打卡', pending, true, 1, 1, 0],
    ['当天全部打卡完成', domain.reduce(pending, { type: 'complete', id: 'read', date: day }, day), true, 1, 0, 1]
  ];
  for (const [label, state, hasHabits, total, pendingCount, completedCount] of cases) {
    const h = harness(t, state), today = h.page('today');
    assert.equal(today.data.dataReady, true, label);
    assert.equal(today.data.hasHabits, hasHabits, label);
    assert.equal(today.data.total, total, label);
    assert.equal(today.data.pending.length, pendingCount, label);
    assert.equal(today.data.completed.length, completedCount, label);
    if (!total) {
      const navigations = [], before = structuredClone(h.app.store.read());
      h.wx.navigateTo = options => navigations.push(options.url);
      today.onCreate({ currentTarget: { dataset: { template: '' } } });
      assert.deepEqual(navigations, ['/pages/edit/index'], label + '的新增打卡进入自定义确认页');
      assert.deepEqual(h.app.store.read(), before, label + '的新增入口不会写入习惯或记录');
    }
  }
});

test('new defaults do not migrate existing goals and are persisted only after explicit creation', t => {
  const day = dates.today();
  const state = domain.reduce(domain.emptyState(), { type: 'create', id: 'existing', startDate: day,
    plan: { title: '原有阅读', target: 5, minimum: 1, unit: '分钟', weekdays: [1, 2, 3, 4, 5, 6, 7], time: '' } }, day);
  const h = harness(t, state), before = structuredClone(h.app.store.read().habits[0]);
  const form = h.page('edit', { template: 'read' });
  assert.equal(h.app.store.read().habits.length, 1);
  form.onSave();
  const habits = h.app.store.read().habits;
  assert.deepEqual(habits.find(item => item.id === 'existing'), before);
  const created = habits.find(item => item.id !== 'existing').versions[0];
  assert.equal(created.target, 30); assert.equal(created.minimum, 10);
});

test('unknown template keys do not read prototype properties', () => {
  for (const key of ['__proto__', 'constructor', 'missing', undefined]) {
    assert.equal(getHabitTemplate(key), null); assert.equal(templatePlan(key), null);
  }
});

test('recorded quantities stay neutral for direct busy completion, adjusted completion and undo', () => {
  const day = '2026-10-07';
  const base = domain.reduce(domain.emptyState(), { type: 'create', id: 'read', startDate: day,
    plan: { ...templatePlan('read'), target: 5, minimum: 2, weekdays: [1, 2, 3, 4, 5, 6, 7], time: '' } }, day);
  const completeMinimum = domain.reduce(base, { type: 'completeMinimum', id: 'read', date: day }, day);
  const adjusted = domain.reduce(domain.reduce(base, { type: 'simplify', id: 'read', date: day, target: 2 }, day),
    { type: 'complete', id: 'read', date: day }, day);
  const undone = domain.reduce(completeMinimum, { type: 'undo', id: 'read', date: day }, day);
  const standard = domain.reduce(base, { type: 'complete', id: 'read', date: day }, day);
  assert.deepEqual(completeMinimum.records, adjusted.records, 'the existing schema has no completion provenance');
  const markup = fs.readFileSync(path.resolve(__dirname, '../miniprogram/templates/task.wxml'), 'utf8');
  assert.doesNotMatch(markup, /今天已调小/);
  // Evaluate both real goal expressions so today and detail cannot drift in their user-facing meaning.
  const expressions = [...markup.matchAll(/<text class="goal-main">\{\{([^}]+)\}\}<\/text>/g)].map(match => match[1]);
  assert.equal(expressions.length, 2);
  for (const expression of expressions) {
    const render = new Function('task', 'return (' + expression + ');');
    const task = state => domain.taskAt(state, state.habits[0], day);
    assert.equal(render(task(completeMinimum)), '本次打卡 2分钟');
    assert.equal(render(task(adjusted)), '本次打卡 2分钟');
    assert.equal(render(task(standard)), '本次打卡 5分钟');
    assert.equal(render(task(undone)), '今天目标 2分钟');
    assert.equal(render(task(base)), '平时目标 5分钟');
    assert.equal(undone.habits[0].versions[0].target, 5, 'presentation changes leave the stored plan unchanged');
  }
  assert.match(markup, /按忙时目标打卡/);
  assert.match(markup, /record-action-goal">忙时 {{task.minimum}}{{task.unit}}/);
  assert.match(markup, /record-action-label">打卡/);
});

test('today uses the user font setting on reentry and falls back safely when unavailable', async t => {
  const h = harness(t, domain.emptyState(), 20), today = h.page('today');
  await today.onShow(); assert.equal(today.data.largeFont, true);
  h.wx.getSystemInfoSync = () => ({ fontSizeSetting: 16 });
  today.onHide(); await today.onShow(); assert.equal(today.data.largeFont, false);
  h.wx.getSystemInfoSync = () => { throw Error('unsupported'); };
  today.onHide(); await today.onShow(); assert.equal(today.data.largeFont, false);
});
