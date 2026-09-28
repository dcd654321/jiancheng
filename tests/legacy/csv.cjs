// Historical CSV export fixture retained for tests of older backups; not bundled.
const dates = require('../../miniprogram/core/date');
const domain = require('../../miniprogram/core/habits');
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
  state.habits.forEach(habit => {
    let date = habit.versions[0].effectiveDate;
    while (date <= end) {
      const task = domain.taskAt(state, habit, date);
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
module.exports = { exportCsv };
