'use strict';

const dates = require('./date');
const domain = require('./habits');
const { lunarDate } = require('./lunar-date');
const DAY_MS = 86400000;
const STATUS_LABELS = { active: '进行中', paused: '已暂停', archived: '已归档' };

function monthOf(date) { dates.assertDate(date); return date.slice(0, 7); }

function assertMonth(month) {
  if (typeof month !== 'string' || !/^\d{4}-\d{2}$/.test(month)) throw Error('月份格式无效');
  dates.assertDate(month + '-01');
  return month;
}

function shiftMonth(month, amount) {
  assertMonth(month);
  if (!Number.isInteger(amount)) throw Error('月份偏移无效');
  const index = Number(month.slice(0, 4)) * 12 + Number(month.slice(5)) - 1 + amount;
  if (index < 0 || index > 9999 * 12 + 11) throw Error('月份超出范围');
  return String(Math.floor(index / 12)).padStart(4, '0') + '-' + String(index % 12 + 1).padStart(2, '0');
}

function monthEnd(month) {
  assertMonth(month);
  if (month === '9999-12') return '9999-12-31';
  return dates.shift(shiftMonth(month, 1) + '-01', -1);
}

function clampDate(date, min, max) {
  dates.assertDate(date); dates.assertDate(min); dates.assertDate(max);
  if (min > max) throw Error('日期边界无效');
  return date < min ? min : date > max ? max : date;
}

function shiftSelectedMonth(selectedDate, amount) {
  dates.assertDate(selectedDate);
  const month = shiftMonth(monthOf(selectedDate), amount);
  const day = Math.min(Number(selectedDate.slice(8)), Number(monthEnd(month).slice(8)));
  return month + '-' + String(day).padStart(2, '0');
}

function earliestDate(state, today) {
  dates.assertDate(today);
  return state.habits.reduce((first, habit) => habit.createdDate < first ? habit.createdDate : first, today);
}

function planLabel(plan) {
  return `${plan.target}${plan.unit} · ${domain.weekdayText(plan.weekdays)}`;
}

// The caller supplies a confirmed account state. A missing account is never an empty account.
function assertState(state) { domain.validateState(state); }

function habitOnDay(state, habit, date, today) {
  if (habit.createdDate > date) return null;
  const version = domain.versionAt(habit, date);
  const display = version || habit.versions[0];
  const task = domain.taskAt(state, habit, date);
  const isFuture = date > today;
  let status, statusText, tone;
  if (task) {
    status = task.status;
    statusText = task.status === 'standard' ? '原目标打卡' : task.status === 'minimum' ? '忙时打卡'
      : isFuture ? '未到日期' : date === today ? '待打卡' : '未打卡';
    tone = task.done ? task.status : isFuture ? 'future' : 'pending';
  } else {
    status = !version ? 'notStarted' : version.status === 'active' ? 'rest' : version.status;
    statusText = !version ? '尚未开始' : version.status === 'active' ? '休息日'
      : STATUS_LABELS[version.status];
    tone = 'rest';
  }
  return {
    id: habit.id, date, title: display.title,
    target: task ? task.target : display.target, originalTarget: display.target,
    unit: display.unit, minimum: display.minimum, time: display.time,
    targetLabel: `${task ? task.target : display.target}${display.unit}`,
    planLabel: planLabel(display), status, statusText, tone,
    planned: !!task, done: !!task && task.done, isFuture,
    note: task ? task.note : '',
    versionRevision: display.revision
  };
}

function projectConfirmedDay(state, date, today, includeHabits = true) {
  const tasks = domain.tasksOn(state, date).map(task => ({ ...task,
    statusText: task.status === 'standard' ? '原目标打卡' : task.status === 'minimum' ? '忙时打卡'
      : date > today ? '未到日期' : date === today ? '待打卡' : '未打卡' }));
  const standard = tasks.filter(task => task.status === 'standard').length;
  const minimum = tasks.filter(task => task.status === 'minimum').length;
  const done = standard + minimum, planned = tasks.length;
  const isToday = date === today, isFuture = date > today;
  const tone = isFuture ? 'future' : !planned ? 'rest' : !done ? 'pending' : done === planned ? 'full' : 'partial';
  const lunar = lunarDate(date);
  const habits = includeHabits ? state.habits.map(habit => habitOnDay(state, habit, date, today)).filter(Boolean)
    .sort((a, b) => {
      const group = row => row.done ? 0 : row.planned ? 1 : 2;
      return group(a) - group(b) || (a.time || '99:99').localeCompare(b.time || '99:99') || a.id.localeCompare(b.id);
    }) : [];
  return {
    key: date, date, day: Number(date.slice(8)), weekday: '一二三四五六日'[dates.weekday(date) - 1],
    label: dates.label(date), lunarLabel: lunar ? lunar.shortLabel : '',
    lunarDetail: lunar ? lunar.fullLabel : '', lunar, isToday, isFuture,
    planned, standard, minimum, done, pending: isFuture ? 0 : planned - done,
    tone, mark: isFuture ? '未到' : planned ? `${done}/${planned}` : '休',
    description: `${dates.label(date)}，${planned ? `记录${done}/${planned}项，原目标${standard}项，忙时${minimum}项` : '休息，无安排'}${isFuture ? '，未到日期' : ''}${isToday ? '，今天进行中' : ''}`,
    standardPercent: planned ? standard / planned * 100 : 0,
    minimumPercent: planned ? minimum / planned * 100 : 0,
    tasks, habits
  };
}

function projectDay(state, date, today) {
  assertState(state); dates.assertDate(date); dates.assertDate(today);
  return projectConfirmedDay(state, date, today);
}

function countCells(cells) {
  const result = { planned: 0, standard: 0, minimum: 0, done: 0, pending: 0,
    activeDays: 0, scheduledDays: 0, rate: null };
  cells.forEach(cell => {
    result.planned += cell.planned; result.standard += cell.standard; result.minimum += cell.minimum;
    result.done += cell.done; result.pending += cell.pending;
    if (cell.done) result.activeDays += 1;
    if (cell.planned) result.scheduledDays += 1;
  });
  result.rate = result.planned ? Math.round(result.done / result.planned * 100) : null;
  return result;
}

function countHabit(cells, id) {
  const selected = cells.map(cell => {
    const task = cell.tasks.find(item => item.id === id);
    return { planned: task ? 1 : 0, standard: task && task.status === 'standard' ? 1 : 0,
      minimum: task && task.status === 'minimum' ? 1 : 0,
      done: task && task.done ? 1 : 0, pending: task && !task.done ? 1 : 0 };
  });
  return countCells(selected);
}

function summarizeRange(state, { start, end, today }) {
  assertState(state); dates.assertDate(start); dates.assertDate(end); dates.assertDate(today);
  if (start > end || end > today) throw Error('统计日期范围无效');
  const days = Math.round((Date.parse(end + 'T00:00:00.000Z') - Date.parse(start + 'T00:00:00.000Z')) / DAY_MS) + 1;
  const cells = dates.range(end, days).map(date => projectConfirmedDay(state, date, today, false));
  const closedCells = cells.filter(cell => cell.date < today);
  const totals = countCells(cells), closed = { ...countCells(closedCells), cells: closedCells };
  const todayCell = projectConfirmedDay(state, today, today);
  const habits = state.habits.map(habit => {
    const total = countHabit(cells, habit.id), counts = countHabit(closedCells, habit.id);
    const current = domain.versionAt(habit, today);
    const latest = habit.versions[habit.versions.length - 1];
    const display = current || habit.versions[0];
    if (!total.planned && !(habit.createdDate <= today && display.status === 'active')) return null;
    const todayHabit = todayCell.habits.find(row => row.id === habit.id);
    const lastDone = cells.filter(cell => cell.tasks.some(task => task.id === habit.id && task.done)).slice(-1)[0];
    return {
      id: habit.id, title: display.title, target: display.target, unit: display.unit,
      planLabel: planLabel(display), statusLabel: STATUS_LABELS[latest.status],
      status: latest.status,
      todayStatusText: todayHabit ? todayHabit.statusText : '尚未创建',
      todayTarget: todayHabit ? todayHabit.targetLabel : '',
      ...counts, closed: counts, total,
      standardPercent: counts.planned ? counts.standard / counts.planned * 100 : 0,
      minimumPercent: counts.planned ? counts.minimum / counts.planned * 100 : 0,
      lastDoneDate: lastDone ? lastDone.date : ''
    };
  }).filter(Boolean);
  return { start, end, days, cells, habits, ...totals, totals, closed, todayCell, earliestDate: earliestDate(state, today) };
}

function buildMonth(state, { month, selectedDate, today }) {
  assertState(state); dates.assertDate(today); assertMonth(month);
  if (selectedDate != null && selectedDate !== '') dates.assertDate(selectedDate);
  const minDate = earliestDate(state, today), maxDate = today;
  const firstMonth = monthOf(minDate), lastMonth = monthOf(today);
  const displayMonth = month < firstMonth ? firstMonth : month > lastMonth ? lastMonth : month;
  const start = displayMonth + '-01', end = monthEnd(displayMonth);
  const firstSelectable = minDate > start ? minDate : start;
  const selection = clampDate(selectedDate || today, firstSelectable, end);
  const cells = Array.from({ length: dates.weekday(start) - 1 }, (_, index) => ({ key: `before-${index}`, blank: true }));
  const length = Number(end.slice(8));
  for (let day = 1; day <= length; day += 1) {
    const date = displayMonth + '-' + String(day).padStart(2, '0');
    const projected = projectConfirmedDay(state, date, today, false);
    cells.push({ ...projected, blank: false, selected: date === selection, beforeStart: date < minDate });
  }
  while (cells.length % 7) cells.push({ key: `after-${cells.length}`, blank: true });
  return {
    month: displayMonth, monthLabel: `${Number(displayMonth.slice(0, 4))}年${Number(displayMonth.slice(5))}月`,
    cells, selected: projectConfirmedDay(state, selection, today), selectedDate: selection,
    minDate, maxDate, canPrevious: displayMonth > firstMonth, canNext: displayMonth < lastMonth
  };
}

module.exports = { summarizeRange, buildMonth, projectDay, earliestDate, monthOf, shiftMonth, monthEnd, shiftSelectedMonth, clampDate };
