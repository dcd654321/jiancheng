'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const domain = require('../miniprogram/core/habits');
const dates = require('../miniprogram/core/date');
const { advise } = require('../miniprogram/core/progress-advice');
const { summarizeRange, buildMonth, projectDay, earliestDate, monthOf,
  shiftMonth, monthEnd, shiftSelectedMonth, clampDate } = require('../miniprogram/core/progress-review');
const plan = overrides => ({ title: '读一会儿', target: 10, minimum: 2, unit: '分钟',
  weekdays: [1, 2, 3, 4, 5, 6, 7], time: '', ...overrides });
function create(state, id, day, overrides, startDate = day) {
  return domain.reduce(state || domain.emptyState(), { type: 'create', id, startDate, plan: plan(overrides) }, day);
}
function command(state, id, day, type, extra = {}) {
  return domain.reduce(state, { type, id, date: day, ...extra }, day);
}
function status(state, id, day, value) {
  return command(state, id, day, 'status', { status: value, baseRevision: domain.findHabit(state, id).revision });
}
function summarize(state, today, days = 7) {
  return summarizeRange(state, { start: dates.shift(today, 1 - days), end: today, today });
}

test('progress includes today in action counts while unfinished today cannot lower the closed rate', () => {
  const today = '2026-10-11';
  let state = create(null, 'read', '2026-10-05');
  state = command(state, 'read', '2026-10-06', 'complete');
  state = command(state, 'read', '2026-10-10', 'completeMinimum');
  state = command(state, 'read', today, 'complete');
  state = create(state, 'new', today, { title: '散步' });
  const result = summarize(state, today);
  assert.equal(result.start, '2026-10-05'); assert.equal(result.end, today);
  assert.equal(result.activeDays, 3); assert.equal(result.scheduledDays, 7);
  assert.equal(result.planned, 8); assert.equal(result.done, 3);
  assert.equal(result.standard, 2); assert.equal(result.minimum, 1);
  assert.equal(result.closed.planned, 6); assert.equal(result.closed.done, 2);
  assert.equal(result.closed.rate, 33); assert.equal(result.closed.cells.length, 6);
  assert.equal(result.todayCell.planned, 2); assert.equal(result.todayCell.done, 1);
  assert.equal(result.todayCell.pending, 1); assert.equal(result.todayCell.isToday, true);
  assert.equal(result.cells.at(-1).mark, '1/2');
  const read = result.habits.find(row => row.id === 'read');
  assert.equal(read.planned, 6); assert.equal(read.done, 2); assert.equal(read.rate, 33);
  assert.equal(read.total.done, 3); assert.equal(read.todayStatusText, '原目标打卡');
  assert.equal(read.todayTarget, '10分钟');
});

test('starting today has no historical denominator and tomorrow-starting habits remain visible', () => {
  const today = '2026-10-11';
  let state = create(null, 'today', today);
  state = command(state, 'today', today, 'complete');
  state = create(state, 'tomorrow', today, { target: 5 }, '2026-10-12');
  const result = summarize(state, today, 30);
  assert.equal(result.start, '2026-09-12'); assert.equal(result.days, 30);
  assert.equal(result.activeDays, 1); assert.equal(result.done, 1);
  assert.equal(result.closed.planned, 0); assert.equal(result.closed.rate, null);
  assert.equal(result.habits.length, 2);
  const future = result.habits.find(row => row.id === 'tomorrow');
  assert.equal(future.planned, 0); assert.equal(future.rate, null);
  assert.equal(future.statusLabel, '进行中'); assert.equal(future.todayStatusText, '尚未开始');
  assert.equal(result.earliestDate, today);
});

test('closed rate weights actual planned tasks instead of averaging daily percentages', () => {
  let state = create(null, 'monday', '2026-10-05', { weekdays: [1] });
  for (const id of ['tue1', 'tue2', 'tue3']) state = create(state, id, '2026-10-05', { weekdays: [2] });
  state = command(state, 'monday', '2026-10-05', 'complete');
  const result = summarize(state, '2026-10-07');
  assert.equal(result.closed.planned, 4); assert.equal(result.closed.done, 1);
  assert.equal(result.closed.rate, 25);
  assert.equal(result.closed.scheduledDays, 2); assert.equal(result.closed.activeDays, 1);
  assert.equal(advise(result.closed), null, 'two scheduled dates do not justify a trend suggestion');
});

test('no plans produce null rates and zero counts rather than an artificial zero percent', () => {
  const state = domain.emptyState(), today = '2026-10-11';
  const result = summarize(state, today);
  assert.equal(result.activeDays, 0); assert.equal(result.rate, null);
  assert.equal(result.closed.rate, null); assert.equal(result.habits.length, 0);
  assert.ok(result.cells.every(cell => cell.tone === 'rest' && cell.mark === '休'));
  assert.equal(advise(result.closed), null);
  assert.equal(result.todayCell.habits.length, 0);
  assert.equal(earliestDate(state, today), today);
});

test('arbitrary lighter targets preserve the exact recorded amount and busy classification', () => {
  let state = create(null, 'read', '2026-10-05');
  state = command(state, 'read', '2026-10-05', 'simplify', { target: 1 });
  state = command(state, 'read', '2026-10-05', 'complete');
  state = command(state, 'read', '2026-10-05', 'note', { note: '今天读了一页。' });
  const day = projectDay(state, '2026-10-05', '2026-10-11');
  assert.equal(day.minimum, 1); assert.equal(day.standard, 0); assert.equal(day.done, 1);
  assert.equal(day.tasks[0].statusText, '忙时打卡');
  assert.equal(day.habits[0].target, 1); assert.equal(day.habits[0].originalTarget, 10);
  assert.equal(day.habits[0].note, '今天读了一页。');
  assert.equal(day.standardPercent, 0); assert.equal(day.minimumPercent, 100);
  assert.match(day.description, /记录1\/1项，原目标0项，忙时1项/);
});

test('editing tomorrow does not change historic titles targets notes or denominator', () => {
  let state = create(null, 'read', '2026-10-05');
  state = command(state, 'read', '2026-10-05', 'complete');
  state = command(state, 'read', '2026-10-05', 'note', { note: '旧名称时的备注' });
  const historic = projectDay(state, '2026-10-05', '2026-10-11');
  state = command(state, 'read', '2026-10-10', 'edit', { baseRevision: 1,
    plan: plan({ title: '新名称', target: 5, minimum: 1, weekdays: [1, 3, 5] }) });
  assert.deepEqual(projectDay(state, '2026-10-05', '2026-10-11'), historic);
  const result = summarize(state, '2026-10-11');
  assert.equal(result.closed.planned, 6); assert.equal(result.habits[0].title, '新名称');
  assert.equal(result.habits[0].todayStatusText, '休息日');
  assert.equal(result.cells.at(-1).planned, 0);
});

test('pause archive and resume preserve past arrangements and exclude inactive dates', () => {
  let state = create(null, 'paused', '2026-10-05');
  state = create(state, 'archived', '2026-10-05');
  for (const id of ['paused', 'archived']) state = command(state, id, '2026-10-05', 'complete');
  state = status(state, 'paused', '2026-10-05', 'paused');
  state = status(state, 'archived', '2026-10-05', 'archived');
  let result = summarize(state, '2026-10-11');
  assert.equal(result.planned, 2); assert.equal(result.closed.rate, 100);
  assert.deepEqual(result.habits.map(row => row.statusLabel), ['已暂停', '已归档']);
  const inactive = projectDay(state, '2026-10-06', '2026-10-11');
  assert.equal(inactive.tasks.length, 0); assert.equal(inactive.habits.length, 2);
  assert.deepEqual(inactive.habits.map(row => row.statusText), ['已归档', '已暂停']);
  state = status(state, 'paused', '2026-10-08', 'active');
  result = summarize(state, '2026-10-11');
  assert.equal(result.planned, 5); assert.equal(result.closed.planned, 4);
  assert.equal(result.todayCell.planned, 1);
});

test('selected day includes every already created habit and sorts completed pending and no plans', () => {
  const day = '2026-10-11';
  let state = create(null, 'rest', '2026-10-10', { weekdays: [1] });
  state = create(state, 'done', '2026-10-10');
  state = create(state, 'pending', '2026-10-10');
  state = create(state, 'not_started', day, {}, '2026-10-12');
  state = command(state, 'done', day, 'complete');
  const result = projectDay(state, day, day);
  assert.deepEqual(result.habits.map(row => row.id), ['done', 'pending', 'not_started', 'rest']);
  assert.deepEqual(result.habits.map(row => row.statusText), ['原目标打卡', '待打卡', '尚未开始', '休息日']);
  assert.equal(result.tasks.length, 2); assert.equal(result.pending, 1);
  assert.equal(projectDay(state, '2026-10-10', day).habits.length, 3);
  assert.equal(projectDay(state, '2026-10-09', day).habits.length, 0);
});

test('same titles remain separate habits and their target and schedule distinguish them', () => {
  let state = create(null, 'read_minutes', '2026-10-05');
  state = create(state, 'read_pages', '2026-10-05', { unit: '页', target: 5, minimum: 1, weekdays: [1] });
  state = command(state, 'read_pages', '2026-10-05', 'complete');
  const result = summarize(state, '2026-10-11');
  assert.equal(result.habits.length, 2); assert.equal(result.habits[0].title, result.habits[1].title);
  assert.notEqual(result.habits[0].planLabel, result.habits[1].planLabel);
  assert.equal(result.habits[0].done, 0); assert.equal(result.habits[1].done, 1);
});

test('deleted habits follow existing removal semantics and never reappear in the calendar', () => {
  let state = create(null, 'deleted', '2026-10-05');
  state = command(state, 'deleted', '2026-10-05', 'complete');
  state = command(state, 'deleted', '2026-10-11', 'deleteHabit', { baseRevision: 1 });
  assert.equal(summarize(state, '2026-10-11').done, 0);
  assert.equal(projectDay(state, '2026-10-05', '2026-10-11').habits.length, 0);
});

test('Chinese calendar uses Monday first and whole-week blank placeholders at each edge', () => {
  const state = create(null, 'old', '2026-08-01'), today = '2026-10-11';
  const august = buildMonth(state, { month: '2026-08', selectedDate: '2026-08-20', today });
  assert.equal(august.cells.length, 42); assert.equal(august.cells.filter(cell => cell.blank).length, 11);
  assert.equal(august.cells.findIndex(cell => cell.date === '2026-08-01'), 5);
  assert.equal(august.cells.filter(cell => !cell.blank).length, 31);
  assert.equal(august.monthLabel, '2026年8月'); assert.equal(august.selectedDate, '2026-08-20');
  assert.equal(august.selected.habits.length, 1);
  assert.equal(august.cells.find(cell => cell.selected).date, august.selectedDate);
  assert.ok(august.cells.every(cell => cell.blank || cell.habits.length === 0), 'grid cells do not duplicate the complete habit list');
  assert.equal(new Set(august.cells.map(cell => cell.key)).size, august.cells.length);
});

test('month navigation clamps to existing creation month and current month with precise picker dates', () => {
  const state = create(null, 'old', '2026-09-12'), today = '2026-10-11';
  const first = buildMonth(state, { month: '2026-01', selectedDate: '2026-01-01', today });
  assert.equal(first.month, '2026-09'); assert.equal(first.selectedDate, '2026-09-12');
  assert.equal(first.minDate, '2026-09-12'); assert.equal(first.maxDate, today);
  assert.equal(first.canPrevious, false); assert.equal(first.canNext, true);
  assert.equal(first.cells.find(cell => cell.date === '2026-09-01').beforeStart, true);
  const last = buildMonth(state, { month: '2027-03', selectedDate: '2027-03-30', today });
  assert.equal(last.month, '2026-10'); assert.equal(last.selectedDate, '2026-10-31');
  assert.equal(last.canPrevious, true); assert.equal(last.canNext, false);
  const empty = buildMonth(domain.emptyState(), { month: '2026-09', today });
  assert.equal(empty.month, '2026-10'); assert.equal(empty.selectedDate, today);
  assert.equal(empty.canPrevious, false); assert.equal(empty.canNext, false);
});

test('future dates show read-only arrangements without unfinished or missed counts', () => {
  const state = create(null, 'read', '2026-10-11');
  const calendar = buildMonth(state, { month: '2026-10', selectedDate: '2026-10-12', today: '2026-10-11' });
  assert.equal(calendar.selected.isFuture, true); assert.equal(calendar.selected.planned, 1);
  assert.equal(calendar.selected.pending, 0); assert.equal(calendar.selected.tone, 'future');
  assert.equal(calendar.selected.mark, '未到');
  assert.equal(calendar.selected.habits[0].statusText, '未到日期');
  assert.equal(calendar.selected.habits[0].tone, 'future');
});

test('month shift preserves day numbers when possible and clips month end across leap years', () => {
  assert.equal(shiftMonth('2026-12', 1), '2027-01');
  assert.equal(shiftMonth('2027-01', -1), '2026-12');
  assert.equal(monthOf('2026-12-31'), '2026-12');
  assert.equal(shiftSelectedMonth('2026-01-31', 1), '2026-02-28');
  assert.equal(shiftSelectedMonth('2024-01-31', 1), '2024-02-29');
  assert.equal(shiftSelectedMonth('2024-02-29', 12), '2025-02-28');
  assert.equal(shiftSelectedMonth('2026-12-31', 1), '2027-01-31');
  assert.equal(monthEnd('2024-02'), '2024-02-29');
  assert.equal(clampDate('2026-09-01', '2026-09-12', '2026-10-11'), '2026-09-12');
});

test('calendar month with a Monday first does not insert a leading week', () => {
  const state = create(null, 'old', '2024-01-01');
  const february = buildMonth(state, { month: '2027-02', today: '2027-02-28' });
  assert.equal(february.cells.length, 28); assert.equal(february.cells[0].date, '2027-02-01');
  const leap = buildMonth(state, { month: '2024-02', selectedDate: '2024-02-29', today: '2027-02-28' });
  assert.equal(leap.cells.length, 35); assert.equal(leap.selectedDate, '2024-02-29');
});

test('day projection carries short and complete lunar information but hides unsupported lunar dates', () => {
  const state = domain.emptyState();
  const festival = projectDay(state, '2026-02-17', '2026-10-11');
  assert.equal(festival.lunarLabel, '春节'); assert.equal(festival.lunarDetail, '农历正月初一');
  const unsupported = projectDay(state, '1899-12-31', '2026-10-11');
  assert.equal(unsupported.lunarLabel, ''); assert.equal(unsupported.lunarDetail, '');
  assert.equal(unsupported.lunar, null); assert.equal(unsupported.day, 31);
});

test('projections leave account state and original 7/28 day summary contracts unchanged', () => {
  let state = create(null, 'read', '2026-09-15');
  state = command(state, 'read', '2026-10-10', 'complete');
  const before = JSON.stringify(state), original7 = domain.summary(state, '2026-10-11', 7);
  const original28 = domain.summary(state, '2026-10-11', 28);
  const freeze = value => { Object.freeze(value); Object.values(value).forEach(child => {
    if (child && typeof child === 'object' && !Object.isFrozen(child)) freeze(child);
  }); };
  freeze(state);
  summarize(state, '2026-10-11', 30);
  buildMonth(state, { month: '2026-09', selectedDate: '2026-09-30', today: '2026-10-11' });
  projectDay(state, '2026-10-10', '2026-10-11');
  assert.equal(JSON.stringify(state), before);
  assert.deepEqual(domain.summary(state, '2026-10-11', 7), original7);
  assert.deepEqual(domain.summary(state, '2026-10-11', 28), original28);
  assert.throws(() => domain.summary(state, '2026-10-11', 30), /只支持/);
});

test('invalid or missing state dates and navigation inputs cannot produce fake statistics', () => {
  const state = domain.emptyState(), today = '2026-10-11';
  assert.throws(() => summarizeRange(null, { start: today, end: today, today }), /记录格式/);
  assert.throws(() => summarizeRange(state, { start: today, end: '2026-10-12', today }), /统计日期/);
  assert.throws(() => summarizeRange(state, { start: today, end: '2026-10-10', today }), /统计日期/);
  assert.throws(() => projectDay(state, '2026-02-30', today), /日期/);
  assert.throws(() => buildMonth(state, { month: '2026-2', today }), /月份/);
  assert.throws(() => buildMonth(state, { month: '2026-13', today }), /日期/);
  assert.throws(() => buildMonth(state, { month: '2026-10', selectedDate: '2026-10-32', today }), /日期/);
  assert.throws(() => shiftMonth('2026-10', 0.5), /偏移/);
  assert.throws(() => clampDate(today, '2026-11-01', '2026-10-01'), /边界/);
});
