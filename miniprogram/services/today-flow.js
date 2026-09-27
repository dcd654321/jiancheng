const domain = require('../core/habits');
const dates = require('../core/date');

// A new active plan persists beyond its start. Check every existing version boundary.
function canAddFrom(state, start) {
  const checkpoints = new Set([start]);
  state.habits.forEach(h => h.versions.forEach(v => {
    if (v.effectiveDate >= start) checkpoints.add(v.effectiveDate);
  }));
  return Array.from(checkpoints).every(day => state.habits.filter(h => {
    const version = domain.versionAt(h, day);
    return version && version.status === 'active';
  }).length < 5);
}

function creationAvailability(state, day) {
  return { today: canAddFrom(state, day), tomorrow: canAddFrom(state, dates.shift(day, 1)) };
}

function tomorrowSummary(state, day) {
  const tomorrow = dates.shift(day, 1), tasks = domain.tasksOn(state, tomorrow);
  return { date: tomorrow, label: dates.label(tomorrow), count: tasks.length,
    tasks: tasks.slice(0, 3).map(t => ({ id: t.id, title: t.title, time: t.time, target: t.target, unit: t.unit })),
    remaining: Math.max(0, tasks.length - 3) };
}

function pendingRows(pending, completed, recent, day, context, now) {
  const rows = pending.map(task => ({ id: task.id, task, undo: false }));
  if (!recent || recent.date !== day || recent.context !== context || recent.until <= now) return rows;
  const task = completed.find(t => t.id === recent.id);
  if (!task) return rows;
  // Preserve the completed item's position relative to the remaining visible tasks.
  const index = rows.findIndex(row => recent.order.indexOf(row.id) > recent.order.indexOf(recent.id));
  rows.splice(index < 0 ? rows.length : index, 0, { id: task.id, task, undo: true });
  return rows;
}

module.exports = { creationAvailability, tomorrowSummary, pendingRows };
