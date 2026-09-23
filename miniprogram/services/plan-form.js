const domain = require('../core/habits');
function fields(input) {
  const errors = {}, limit = input.unit === '分钟' ? 120 : 999;
  if (!String(input.title || '').trim() || Array.from(String(input.title).trim()).length > 20) errors.title = '习惯名称需要1—20个字';
  if (!['分钟', '页', '次'].includes(input.unit)) errors.target = '请选择目标单位';
  else if (!Number.isInteger(Number(input.target)) || Number(input.target) < 1 || Number(input.target) > limit) errors.target = `请输入1—${limit}的整数`;
  if (!Array.isArray(input.weekdays) || !input.weekdays.length || input.weekdays.some(n => ![1, 2, 3, 4, 5, 6, 7].includes(n))) errors.weekdays = '请至少选择一个星期中的日期';
  if (input.minimum !== '' && input.minimum != null && (!Number.isInteger(Number(input.minimum)) || Number(input.minimum) < 1 || Number(input.minimum) >= Number(input.target))) errors.minimum = '请输入小于每次目标的正整数，或留空';
  if (input.time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time)) errors.time = '请选择有效的计划时间';
  return errors;
}
function presentation(input) {
  const extras = [];
  if (input.time) extras.push(input.time);
  if (!input.editing && input.startOffset === 1) extras.push('明天开始');
  return { titleCount: Array.from(String(input.title || '')).length,
    targetHint: `1—${input.unit === '分钟' ? 120 : 999}，填整数`,
    frequencyLabel: domain.weekdayText(input.weekdays), moreSummary: extras.join(' · ') || (input.editing ? '计划时间' : '计划时间、开始日期') };
}
module.exports = { fields, presentation };
