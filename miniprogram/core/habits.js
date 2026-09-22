const dates = require('./date');
const SCHEMA_VERSION = 1;
const clone = value => JSON.parse(JSON.stringify(value));
const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7];
const safeId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(value) && !['__proto__', 'constructor', 'prototype'].includes(value);

function emptyState() {
  return { schemaVersion: SCHEMA_VERSION, revision: 0, habits: [], records: {}, settings: { hideQuote: false } };
}

function validatePlan(input) {
  const title = String(input.title || '').trim();
  if (!title || Array.from(title).length > 20) throw Error('习惯名称需要1—20个字');
  if (!['分钟', '页', '次'].includes(input.unit)) throw Error('请选择目标单位');
  const target = Number(input.target);
  if (!Number.isInteger(target) || target < 1 || target > (input.unit === '分钟' ? 120 : 999)) throw Error('目标数量超出允许范围');
  const minimum = input.minimum === '' || input.minimum == null ? null : Number(input.minimum);
  if (minimum !== null && (!Number.isInteger(minimum) || minimum < 1 || minimum >= target)) throw Error('简化目标需大于0、小于原目标');
  if (!Array.isArray(input.weekdays) || !input.weekdays.length || input.weekdays.some(n => !ALL_DAYS.includes(n))) throw Error('至少选择一个执行星期');
  const time = input.time || '';
  if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw Error('计划时间格式无效');
  return { title, target, minimum, unit: input.unit, weekdays: Array.from(new Set(input.weekdays)).sort(), time };
}

function versionAt(habit, date) {
  return habit.versions.filter(v => v.effectiveDate <= date).slice(-1)[0] || null;
}

function findHabit(state, id) {
  const habit = state.habits.find(h => h.id === id);
  if (!habit) throw Error('未找到这个习惯');
  return habit;
}

function key(id, date) { return `${id}@${date}`; }

function taskAt(state, habit, date) {
  dates.assertDate(date);
  const version = versionAt(habit, date);
  if (!version || version.status !== 'active' || !version.weekdays.includes(dates.weekday(date))) return null;
  const saved = state.records[key(habit.id, date)];
  const target = saved ? saved.todayTarget : version.target;
  const status = saved ? saved.status : 'pending';
  return {
    id: habit.id, date, title: version.title, unit: version.unit, time: version.time,
    originalTarget: version.target, target, minimum: version.minimum,
    status, done: status !== 'pending', simplified: target < version.target,
    statusText: status === 'standard' ? '原目标完成' : status === 'minimum' ? '简化完成' : '未记录',
    note: saved ? saved.note : '', versionRevision: version.revision
  };
}

function tasksOn(state, date) {
  return state.habits.map(h => taskAt(state, h, date)).filter(Boolean)
    .sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99') || a.id.localeCompare(b.id));
}

function assertCapacity(state, date) {
  const checkpoints = new Set([date]);
  state.habits.forEach(h => h.versions.forEach(v => { if (v.effectiveDate >= date) checkpoints.add(v.effectiveDate); }));
  checkpoints.forEach(point => {
    if (state.habits.filter(h => { const v = versionAt(h, point); return v && v.status === 'active'; }).length > 5) {
      throw Error('最多同时进行5个习惯，先暂停或归档一个');
    }
  });
}

/** Pure reducer. All writes return a new state; storage failure cannot mutate the live state. */
function reduce(state, command, nowDate) {
  dates.assertDate(nowDate);
  const next = clone(state);
  if (command.type === 'create') {
    if (!safeId(command.id)) throw Error('习惯标识无效');
    // A retained form id makes repeated create submissions idempotent.
    if (state.habits.some(h => h.id === command.id)) return state;
    const start = command.startDate || nowDate;
    if (![nowDate, dates.shift(nowDate, 1)].includes(start)) throw Error('只能从今天或明天开始');
    const plan = validatePlan(command.plan);
    next.habits.push({ id: command.id, createdDate: nowDate, revision: 1,
      versions: [{ ...plan, effectiveDate: start, status: 'active', revision: 1 }] });
    assertCapacity(next, nowDate);
  } else if (['edit', 'status', 'cancelFuture'].includes(command.type)) {
    const habit = findHabit(next, command.id);
    if (command.baseRevision !== habit.revision) throw Error('计划已更新，请返回后重新打开');
    const tomorrow = dates.shift(nowDate, 1);
    if (command.type === 'cancelFuture') {
      if (!habit.versions.some(v => v.effectiveDate === tomorrow)) throw Error('没有待生效的修改');
      if (!versionAt(habit, nowDate)) throw Error('尚未开始的习惯请编辑或归档');
      habit.versions = habit.versions.filter(v => v.effectiveDate !== tomorrow);
      habit.revision += 1;
    } else {
      const base = habit.versions[habit.versions.length - 1];
      const plan = command.type === 'edit' ? validatePlan(command.plan) : validatePlan(base);
      const status = command.type === 'status' ? command.status : base.status;
      if (!['active', 'paused', 'archived'].includes(status)) throw Error('习惯状态无效');
      habit.revision += 1;
      habit.versions = habit.versions.filter(v => v.effectiveDate !== tomorrow);
      habit.versions.push({ ...plan, effectiveDate: tomorrow, status, revision: habit.revision });
    }
    assertCapacity(next, nowDate);
  } else if (['complete', 'undo', 'simplify', 'restore', 'note'].includes(command.type)) {
    if (command.date !== nowDate) throw Error('日期已经变化，请刷新后记录今天');
    const habit = findHabit(next, command.id);
    const task = taskAt(next, habit, nowDate);
    if (!task) throw Error('今天没有安排这个习惯');
    const recordKey = key(habit.id, nowDate);
    const record = next.records[recordKey] || { id: habit.id, date: nowDate,
      versionRevision: task.versionRevision, todayTarget: task.originalTarget, status: 'pending', note: '' };
    if (command.type === 'complete') record.status = record.todayTarget < task.originalTarget ? 'minimum' : 'standard';
    if (command.type === 'undo') record.status = 'pending';
    if (['simplify', 'restore'].includes(command.type)) {
      if (record.status !== 'pending') throw Error('请先撤销今天的记录，再调整目标');
      const target = command.type === 'restore' ? task.originalTarget : Number(command.target);
      if (!Number.isInteger(target) || target < 1 || target > task.originalTarget || (command.type === 'simplify' && target === task.originalTarget)) throw Error('简化目标需大于0、小于原目标');
      record.todayTarget = target;
    }
    if (command.type === 'note') {
      if (typeof command.note !== 'string' || Array.from(command.note).length > 140) throw Error('备注最多140个字');
      record.note = command.note;
    }
    next.records[recordKey] = record;
  } else if (command.type === 'settings') {
    if (typeof command.hideQuote !== 'boolean') throw Error('设置无效');
    next.settings.hideQuote = command.hideQuote;
  } else throw Error('不支持的操作');
  if (JSON.stringify(next) === JSON.stringify(state)) return state;
  next.revision += 1;
  return next;
}

function summary(state, end, days) {
  if (![7, 28].includes(days)) throw Error('只支持近7天或近28天');
  const byHabit = Object.create(null);
  const cells = dates.range(end, days).map(date => {
    const tasks = tasksOn(state, date);
    let standard = 0, minimum = 0;
    tasks.forEach(t => {
      if (t.status === 'standard') standard += 1;
      if (t.status === 'minimum') minimum += 1;
      if (!byHabit[t.id]) byHabit[t.id] = { id: t.id, title: t.title, planned: 0, standard: 0, minimum: 0, done: 0 };
      const row = byHabit[t.id];
      row.title = t.title; row.planned += 1;
      if (t.status === 'standard') row.standard += 1;
      if (t.status === 'minimum') row.minimum += 1;
      row.done = row.standard + row.minimum;
    });
    const done = standard + minimum;
    return { date, day: Number(date.slice(8)), weekday: '一二三四五六日'[dates.weekday(date) - 1],
      planned: tasks.length, standard, minimum, done, tasks,
      tone: !tasks.length ? 'rest' : !done ? 'pending' : done === tasks.length ? 'full' : 'partial',
      description: `${dates.label(date)}，${tasks.length ? `记录${done}/${tasks.length}项，原目标${standard}项，简化${minimum}项` : '休息，无安排'}` };
  });
  const result = { start: cells[0].date, end, days, cells, habits: Object.values(byHabit), planned: 0, standard: 0, minimum: 0 };
  cells.forEach(c => { result.planned += c.planned; result.standard += c.standard; result.minimum += c.minimum; });
  result.done = result.standard + result.minimum;
  result.rate = result.planned ? Math.round(result.done / result.planned * 100) : null;
  return result;
}

function weekdayText(weekdays) {
  if (weekdays.length === 7) return '每天';
  if (JSON.stringify(weekdays) === '[1,2,3,4,5]') return '周一至周五';
  return weekdays.map(n => `周${'一二三四五六日'[n - 1]}`).join('、');
}

function firstExecution(plan, start) {
  for (let n = 0; n < 7; n += 1) { const date = dates.shift(start, n); if (plan.weekdays.includes(dates.weekday(date))) return date; }
  throw Error('至少选择一个执行星期');
}

// CSV formula injection protection is applied before RFC4180 quoting.
function csvCell(value) {
  let text = String(value == null ? '' : value);
  if (/^[\s]*[=+@-]|^[\t\r\n]/.test(text)) text = "'" + text;
  return `"${text.replace(/"/g, '""')}"`;
}

function exportCsv(state, end, includeNotes = false) {
  dates.assertDate(end);
  const head = ['习惯', '计划日期', '原目标', '今日目标', '单位', '状态'];
  if (includeNotes) head.push('备注');
  const rows = [head];
  state.habits.forEach(h => {
    let date = h.versions[0].effectiveDate;
    while (date <= end) {
      const task = taskAt(state, h, date);
      if (task) {
        const row = [task.title, date, task.originalTarget, task.target, task.unit, task.statusText];
        if (includeNotes) row.push(task.note);
        rows.push(row);
      }
      date = dates.shift(date, 1);
    }
  });
  return '\ufeff' + rows.map(row => row.map(csvCell).join(',')).join('\r\n');
}

function validateState(state) {
  if (!state || state.schemaVersion !== SCHEMA_VERSION || !Number.isInteger(state.revision) || state.revision < 0 || !Array.isArray(state.habits) || !state.records || typeof state.records !== 'object' || Array.isArray(state.records) || !state.settings || typeof state.settings.hideQuote !== 'boolean') throw Error('本机数据格式无效，已停止写入以保护记录');
  const ids = new Set();
  state.habits.forEach(h => {
    if (!h || !safeId(h.id) || ids.has(h.id) || !Number.isInteger(h.revision) || h.revision < 1 || !Array.isArray(h.versions) || !h.versions.length) throw Error('习惯数据无效');
    ids.add(h.id); dates.assertDate(h.createdDate);
    let lastDate = '';
    h.versions.forEach(v => {
      validatePlan(v); dates.assertDate(v.effectiveDate);
      if (!Number.isInteger(v.target) || (v.minimum !== null && !Number.isInteger(v.minimum))) throw Error('计划目标的数据类型无效');
      if (v.effectiveDate <= lastDate || v.effectiveDate < h.createdDate || !['active', 'paused', 'archived'].includes(v.status) || !Number.isInteger(v.revision) || v.revision < 1 || v.revision > h.revision) throw Error('计划版本数据无效');
      lastDate = v.effectiveDate;
    });
  });
  Object.keys(state.records).forEach(recordKey => {
    const r = state.records[recordKey];
    if (!r || recordKey !== key(r.id, r.date) || !ids.has(r.id) || typeof r.note !== 'string' || Array.from(r.note).length > 140 || !['pending', 'standard', 'minimum'].includes(r.status)) throw Error('打卡记录数据无效');
    dates.assertDate(r.date);
    const h = findHabit(state, r.id), v = versionAt(h, r.date);
    if (!v || v.status !== 'active' || !v.weekdays.includes(dates.weekday(r.date)) || r.versionRevision !== v.revision || !Number.isInteger(r.todayTarget) || r.todayTarget < 1 || r.todayTarget > v.target || (r.status === 'standard' && r.todayTarget !== v.target) || (r.status === 'minimum' && r.todayTarget >= v.target)) throw Error('打卡记录与计划不一致');
  });
  return state;
}

module.exports = { emptyState, validateState, validatePlan, reduce, versionAt, taskAt, tasksOn, summary, weekdayText, firstExecution, exportCsv, findHabit };
