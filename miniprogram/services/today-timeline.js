'use strict';

// Only project confirmed tasks for display; no task or persistent state is mutated.
function timeline(tasks, showCompleted = true) {
  const sorted = [...tasks].sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99') || a.id.localeCompare(b.id));
  const visible = sorted.filter(task => showCompleted || !task.done);
  const ordinary = visible.filter(task => !task.pinned);
  const firstUnscheduled = ordinary.find(task => !task.time);
  return {
    pinnedTasks: visible.filter(task => task.pinned),
    timelineTasks: ordinary.map(task => ({ ...task, unscheduledStart: task === firstUnscheduled })),
    progressSegments: sorted.map(task => ({ id: task.id, status: task.done ? task.status === 'minimum' ? 'minimum' : 'filled' : '' }))
  };
}
module.exports = { timeline };
