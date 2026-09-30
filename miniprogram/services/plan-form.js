const domain = require('../core/habits');
function fields(input) {
  const errors = {}, limit = input.unit === '分钟' ? 120 : 999;
  if (!String(input.title || '').trim() || Array.from(String(input.title).trim()).length > 20) errors.title = '习惯名称需要1—20个字';
  if (!['分钟', '页', '次'].includes(input.unit)) errors.target = '请选择目标单位';
  else if (!Number.isInteger(Number(input.target)) || Number(input.target) < 1 || Number(input.target) > limit) errors.target = `请输入1—${limit}的整数`;
  if (!Array.isArray(input.weekdays) || !input.weekdays.length || input.weekdays.some(n => ![1, 2, 3, 4, 5, 6, 7].includes(n))) errors.weekdays = '请至少选择一个星期中的日期';
  if (input.minimum !== '' && input.minimum != null && (!Number.isInteger(Number(input.minimum)) || Number(input.minimum) < 1 || Number(input.minimum) >= Number(input.target))) errors.minimum = '忙时目标要小于平时目标：请输入更小的正整数，或留空';
  if (input.time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time)) errors.time = '请选择有效的计划时间';
  return errors;
}
function presentation(input) {
  const extras = [];
  if (input.time) extras.push(input.time);
  const limit = input.unit === '分钟' ? 120 : 999;
  return { titleCount: Array.from(String(input.title || '')).length,
    // 记录说明在今日页只出现一次；编辑页不再重复同一句话。
    targetHint: input.compact ? '' : '完成后点「记下」，不会自动计时。',
    targetPlaceholder: `1—${limit}`,
    frequencyLabel: domain.weekdayText(input.weekdays), moreSummary: extras.join(' · ') || '计划时间' };
}
module.exports = { fields, presentation };
