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

module.exports = { creationAvailability, tomorrowSummary };
