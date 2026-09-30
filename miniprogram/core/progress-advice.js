'use strict';
// 纯规则建议：只使用区间内的计划与完成计数，不推断执行时段等无数据支撑的结论。
// 返回一句面向用户的建议文案；数据不足或没有安排时返回 null。
function advise(stats) {
  if (!stats || !Number.isInteger(stats.planned) || stats.planned <= 0) return null;
  const scheduledDays = Array.isArray(stats.cells) ? stats.cells.filter(cell => cell.planned > 0).length : 0;
  if (scheduledDays < 3) return null;
  const standardRate = stats.standard / stats.planned;
  const minimumRate = stats.minimum / stats.planned;
  const doneRate = stats.done / stats.planned;
  const counts = `安排 ${stats.planned} 次、记录 ${stats.done} 次`;
  if (standardRate >= 0.7) return `${counts}：现在的大小适合你，保持这个节奏。`;
  if (standardRate < 0.4 && minimumRate >= 0.3) return `${counts}，其中 ${stats.minimum} 次是忙时目标：先按这个节奏保持一周。`;
  if (doneRate < 0.3) return `${counts}：把目标或天数缩小一档，会更容易重新开始。`;
  return `${counts}：继续现在的节奏就好。`;
}
module.exports = { advise };
