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

// 本次可见访问内原位保留刚完成的记录：用习惯ID+日期去重，数量上限5，只保留最后5条。
const MAX_RETAINED = 5;
function retainCompletion(list, item) {
  const next = (list || []).filter(entry => !(entry.id === item.id && entry.date === item.date));
  next.push(item);
  return next.slice(-MAX_RETAINED);
}

// 与权威状态相比仍然有效的保留项（被其他设备撤销的行不再原位展示）。
function effectiveRetained(retained, completed, day, context) {
  return (retained || []).filter(item => item && item.date === day && item.context === context &&
    completed.some(task => task.id === item.id));
}

function pendingRows(pending, completed, retained, day, context) {
  const rows = pending.map(task => ({ id: task.id, task, undo: false }));
  for (const item of effectiveRetained(retained, completed, day, context)) {
    const task = completed.find(t => t.id === item.id);
    const order = item.order || [];
    // Preserve the completed item's position relative to the remaining visible tasks.
    const index = rows.findIndex(row => order.indexOf(row.id) > order.indexOf(item.id));
    rows.splice(index < 0 ? rows.length : index, 0, { id: task.id, task, undo: true });
  }
  return rows;
}

module.exports = { creationAvailability, tomorrowSummary, pendingRows, retainCompletion, effectiveRetained, MAX_RETAINED };
