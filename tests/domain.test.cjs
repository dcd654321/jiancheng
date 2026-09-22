const test = require('node:test');
const assert = require('node:assert/strict');
const d = require('../miniprogram/core/date');
const h = require('../miniprogram/core/habits');
const { createStore, STORAGE_KEY } = require('../miniprogram/services/store');
const { validateDraft } = require('../miniprogram/core/ai-contract');
const DAY = '2026-09-10';
const plan = overrides => ({ title: '读一会儿', target: 10, minimum: 2, unit: '分钟', weekdays: [1,2,3,4,5,6,7], time: '21:30', ...overrides });
const create = (state = h.emptyState(), overrides = {}, date = DAY, id = 'read') => h.reduce(state, { type: 'create', id, plan: plan(overrides) }, date);
const task = (state, date = DAY, id = 'read') => h.taskAt(state, h.findHabit(state, id), date);
function record(state, type, extra = {}, now = DAY) { return h.reduce(state, { type, id: 'read', date: now, ...extra }, now); }

test('北京时间在UTC16点跨日，与主机时区无关', () => {
  assert.equal(d.today(Date.parse('2026-09-10T15:59:59Z')), DAY);
  assert.equal(d.today(Date.parse('2026-09-10T16:00:00Z')), '2026-09-11');
  assert.equal(d.shift('2028-02-28', 1), '2028-02-29');
  assert.equal(d.weekday('2026-09-13'), 7);
  assert.throws(() => d.assertDate('2026-02-30'));
});
test('空状态不包含演示数据，空统计不是0%', () => {
  const state = h.emptyState();
  assert.equal(state.habits.length, 0);
  assert.equal(h.summary(state, DAY, 7).rate, null);
});
test('工作日模板从周六开始时，周一才首次执行', () => {
  const state = create(undefined, { weekdays: [1,2,3,4,5] }, '2026-09-12');
  assert.equal(task(state, '2026-09-12'), null);
  assert.equal(task(state, '2026-09-13'), null);
  assert.equal(h.firstExecution(plan({ weekdays: [1,2,3,4,5] }), '2026-09-12'), '2026-09-14');
  assert.ok(task(state, '2026-09-14'));
});
test('创建要求真实字段，不能零目标、非法单位或没有星期', () => {
  for (const invalid of [{ target: 0 }, { target: 1.2 }, { target: 121 }, { weekdays: [] }, { weekdays: [8] }, { minimum: 10 }, { time: '24:01' }, { unit: '公斤' }, { title: ' ' }]) {
    assert.throws(() => create(undefined, invalid));
  }
});
test('创建同ID幂等，不修改原对象', () => {
  const initial = h.emptyState();
  const state = create(initial);
  assert.equal(initial.habits.length, 0);
  assert.equal(create(state).habits.length, 1);
});
test('最多5个活动习惯，未来恢复也不能突破上限', () => {
  let state = h.emptyState();
  for (let n = 0; n < 5; n++) state = create(state, {}, DAY, 'habit' + n);
  assert.throws(() => create(state, {}, DAY, 'sixth'), /最多/);
  state = h.reduce(state, { type: 'status', id: 'habit0', status: 'paused', baseRevision: 1 }, DAY);
  state = h.reduce(state, { type: 'create', id: 'sixth', startDate: '2026-09-11', plan: plan() }, DAY);
  assert.throws(() => h.reduce(state, { type: 'status', id: 'habit0', status: 'active', baseRevision: 2 }, DAY), /最多/);
});
test('完成、重复完成和撤销不重复计数', () => {
  const state = record(create(), 'complete');
  assert.equal(task(state).status, 'standard');
  assert.equal(record(state, 'complete'), state);
  assert.equal(h.summary(state, DAY, 7).done, 1);
  const undone = record(state, 'undo');
  assert.equal(h.summary(undone, DAY, 7).done, 0);
});
test('只能操作当日且当日必须有计划', () => {
  assert.throws(() => record(create(), 'complete', { date: '2026-09-09' }), /日期/);
  assert.throws(() => record(create(), 'complete', { date: '2026-09-11' }), /日期/);
  assert.throws(() => record(create(undefined, { weekdays: [1] }), 'complete'), /没有安排/);
});
test('简化只影响今日，确认简化不会直接打卡', () => {
  let state = record(create(), 'simplify', { target: 2 });
  assert.equal(task(state).target, 2);
  assert.equal(task(state).status, 'pending');
  assert.equal(task(state, '2026-09-11').target, 10);
  state = record(state, 'complete');
  assert.equal(task(state).status, 'minimum');
  assert.equal(h.summary(state, DAY, 7).minimum, 1);
  assert.equal(h.summary(state, DAY, 7).standard, 0);
});
test('完成后不能直接改目标，撤销后才能恢复', () => {
  let state = record(record(create(), 'simplify', { target: 2 }), 'complete');
  assert.throws(() => record(state, 'restore'), /先撤销/);
  state = record(record(state, 'undo'), 'restore');
  assert.equal(task(state).target, 10);
  assert.equal(task(state).status, 'pending');
});
test('无效简化数值被拒绝', () => {
  for (const target of [0, -1, 10, 11, 1.5, 'bad']) assert.throws(() => record(create(), 'simplify', { target }));
});
test('长期编辑只从明日起生效，历史统计不漂移', () => {
  let state = create(undefined, {}, '2026-09-09');
  state = record(state, 'complete', {}, '2026-09-09');
  const before = h.summary(state, DAY, 7);
  state = h.reduce(state, { type: 'edit', id: 'read', baseRevision: 1, plan: plan({ title: '读一点', target: 5, minimum: 1, weekdays: [1] }) }, DAY);
  assert.equal(task(state, '2026-09-09').originalTarget, 10);
  assert.equal(task(state).originalTarget, 10);
  assert.equal(task(state, '2026-09-11'), null);
  assert.equal(task(state, '2026-09-14').originalTarget, 5);
  assert.deepEqual(h.summary(state, DAY, 7), before);
  assert.doesNotThrow(() => h.validateState(state));
});
test('暂停和归档不移除今日分母，归档仍可查历史', () => {
  for (const status of ['paused', 'archived']) {
    let state = record(create(), 'complete');
    state = h.reduce(state, { type: 'status', id: 'read', status, baseRevision: 1 }, DAY);
    assert.equal(h.summary(state, DAY, 7).planned, 1);
    assert.equal(task(state, '2026-09-11'), null);
    assert.equal(h.summary(state, '2026-09-11', 7).habits[0].done, 1);
  }
});
test('同日反复编辑合并明日版本，版本冲突拒绝覆盖', () => {
  let state = h.reduce(create(), { type: 'edit', id: 'read', baseRevision: 1, plan: plan({ target: 6 }) }, DAY);
  assert.throws(() => h.reduce(state, { type: 'edit', id: 'read', baseRevision: 1, plan: plan() }, DAY), /已更新/);
  state = h.reduce(state, { type: 'edit', id: 'read', baseRevision: 2, plan: plan({ target: 7 }) }, DAY);
  assert.equal(state.habits[0].versions.length, 2);
  assert.equal(task(state, '2026-09-11').originalTarget, 7);
  state = h.reduce(state, { type: 'cancelFuture', id: 'read', baseRevision: 3 }, DAY);
  assert.equal(state.habits[0].versions.length, 1);
  assert.equal(task(state, '2026-09-11').originalTarget, 10);
});
test('未打开日期照常计入计划，全部习惯都进入区间统计', () => {
  let state = create(undefined, {}, '2026-09-01');
  state = create(state, { title: '整理桌面' }, '2026-09-03', 'tidy');
  const week = h.summary(state, DAY, 7), month = h.summary(state, DAY, 28);
  assert.equal(week.planned, 14);
  assert.equal(month.planned, 18);
  assert.equal(week.cells.length, 7); assert.equal(month.cells.length, 28);
  assert.equal(month.habits.length, 2);
});
test('CSV保护公式注入，正确转义引号、换行和可选备注', () => {
  let state = create(undefined, { title: '=1+1' });
  state = record(state, 'note', { note: '这是"私人"\n备注' });
  assert.match(h.exportCsv(state, DAY), /'=1\+1/);
  assert.doesNotMatch(h.exportCsv(state, DAY), /私人/);
  assert.match(h.exportCsv(state, DAY, true), /""私人""/);
});
test('备注长度有边界', () => {
  assert.throws(() => record(create(), 'note', { note: '字'.repeat(141) }));
  assert.equal(task(record(create(), 'note', { note: '字'.repeat(140) })).note.length, 140);
});
test('坏记录、不匹配版本和未知schema fail closed', () => {
  const state = record(create(), 'complete');
  assert.doesNotThrow(() => h.validateState(state));
  for (const alter of [s => { s.schemaVersion = 999; }, s => { s.records['read@' + DAY].todayTarget = 1; }, s => { s.habits[0].versions[0].effectiveDate = '2026-02-30'; }]) {
    const bad = JSON.parse(JSON.stringify(state)); alter(bad); assert.throws(() => h.validateState(bad));
  }
});
function memoryStorage() {
  const data = {};
  return { data, getStorageSync: key => data[key], setStorageSync: (key, value) => { data[key] = value; }, removeStorageSync: key => { delete data[key]; } };
}
test('本机存储独立命名，不清除其他工程数据', () => {
  const storage = memoryStorage(); storage.data.other = 'safe';
  const repository = createStore(storage, () => DAY);
  repository.dispatch({ type: 'create', id: 'read', plan: plan() });
  assert.equal(repository.read().habits.length, 1);
  repository.clear(); assert.equal(repository.read().habits.length, 0); assert.equal(storage.data.other, 'safe');
});
test('保存失败不污染已持久化状态、不返回成功', () => {
  const storage = memoryStorage(); const repository = createStore(storage, () => DAY);
  repository.dispatch({ type: 'create', id: 'read', plan: plan() });
  const before = storage.data[STORAGE_KEY];
  storage.setStorageSync = () => { throw Error('Disk full'); };
  assert.throws(() => repository.dispatch({ type: 'complete', id: 'read', date: DAY }), /保存失败/);
  assert.equal(storage.data[STORAGE_KEY], before);
  assert.equal(task(repository.read()).status, 'pending');
});
test('数据损坏不自动覆盖，原始备份仍可取出', () => {
  const storage = memoryStorage(); storage.data[STORAGE_KEY] = '{broken';
  const repository = createStore(storage, () => DAY);
  assert.throws(() => repository.read(), /未覆盖/);
  assert.throws(() => repository.dispatch({ type: 'create', id: 'new', plan: plan() }));
  assert.equal(repository.rawBackup(), '{broken');
});
test('多轮完成/撤销/简化后统计口径仍一致', () => {
  let state = create();
  for (let n = 0; n < 30; n++) {
    state = record(state, 'simplify', { target: 2 }); state = record(state, 'complete');
    assert.equal(h.summary(state, DAY, 7).done, 1);
    state = record(state, 'undo'); state = record(state, 'restore'); state = record(state, 'complete');
    assert.equal(h.summary(state, DAY, 7).standard, 1);
    state = record(state, 'undo'); assert.equal(h.summary(state, DAY, 7).done, 0);
    h.validateState(state);
  }
});
test('AI合同使用用户星期/午间时间，不采用模型擅改的安排', () => {
  const draft = { title: '读一点', target: 5, minimum: 2, unit: '分钟', action: '打开书继续读', reason: '减少启动负担', time: '23:00', weekdays: [7] };
  const result = validateDraft(draft, { minutes: 5, weekdays: [1,2,3,4,5], time: '12:30' });
  assert.equal(result.time, '12:30'); assert.deepEqual(result.weekdays, [1,2,3,4,5]);
  assert.throws(() => validateDraft({ ...draft, target: 15 }, { minutes: 5, weekdays: [1] }));
  assert.throws(() => validateDraft({ ...draft, action: '<script>bad</script>' }, { minutes: 5, weekdays: [1] }));
});
