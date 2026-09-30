'use strict';
// 纯规则建议：只使用区间内的计划与完成计数，不推断执行时段、人格或目标适合度。
// 先给事实（同一周期真实计数），再给条件建议；应做日不足3天不下判断，无安排时返回 null。
function advise(stats) {
  if (!stats || !Number.isInteger(stats.planned) || stats.planned <= 0) return null;
  const scheduledDays = Array.isArray(stats.cells) ? stats.cells.filter(cell => cell.planned > 0).length : 0;
  if (scheduledDays < 3) return null;
  const standardRate = stats.standard / stats.planned;
  const minimumRate = stats.minimum / stats.planned;
  const doneRate = stats.done / stats.planned;
  const facts = `这段时间安排 ${stats.planned} 次、记录 ${stats.done} 次。`;
  if (standardRate >= 0.7) return `${facts}按原目标记录了 ${stats.standard} 次，可以先照这个节奏继续。`;
  if (standardRate < 0.4 && minimumRate >= 0.3) return `${facts}其中 ${stats.minimum} 次选择忙时目标，忙的时候可以继续用它。`;
  if (doneRate < 0.3) return `${facts}如果最近安排偏满，可以到编辑计划调整目标或天数。`;
  return `${facts}按现在的安排继续就好。`;
}
module.exports = { advise };
