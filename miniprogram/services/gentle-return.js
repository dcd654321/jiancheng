const dates = require('../core/date');
const domain = require('../core/habits');

// Only inspect the current account's visible state. Rest days are skipped;
// a completed day or an inactive plan version ends the current run of misses.
function missedScheduledDays(state, habit, today) {
  const current = domain.taskAt(state, habit, today);
  if (!current || current.done) return 0;
  let missed = 0;
  for (let day = dates.shift(today, -1); day >= habit.createdDate; day = dates.shift(day, -1)) {
    const version = domain.versionAt(habit, day);
    if (!version || version.status !== 'active') break;
    if (!version.weekdays.includes(dates.weekday(day))) continue;
    const task = domain.taskAt(state, habit, day);
    if (!task || task.done) break;
    missed += 1;
    if (missed >= 2) return 2;
  }
  return missed;
}

function firstReturnTask(state, today, pendingTasks) {
  for (const task of pendingTasks) {
    const habit = domain.findHabit(state, task.id);
    if (missedScheduledDays(state, habit, today) >= 2) return task;
  }
  return null;
}

module.exports = { missedScheduledDays, firstReturnTask };
