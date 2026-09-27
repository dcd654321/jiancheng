const domain = require('./habits');
const { validateDraft } = require('./ai-contract');
const DIRECTIONS = [
  { id: 'read', label: '阅读', title: '读一会儿', action: '选一本已经在手边的书，从上次停下的位置继续。' },
  { id: 'study', label: '学习', title: '复习一小段', action: '只复习一小段笔记，结束时说出今天记住的一点。' },
  { id: 'tidy', label: '整理', title: '整理桌面', action: '只整理眼前一小块桌面，将不需要的物品归位。' },
  { id: 'walk', label: '日常散步', title: '轻松走一会儿', action: '在熟悉、安全的地方按舒适节奏散步，不追求速度；不适时停止。' }
];
function validateInput(input) {
  if (!input || !DIRECTIONS.some(x => x.id === input.direction)) throw Error('请选择习惯方向');
  const minutes = Number(input.minutes);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 60) throw Error('可用时间需要1—60分钟');
  const plan = domain.validatePlan({ title: '校验安排', target: minutes, minimum: null, unit: '分钟', weekdays: input.weekdays, time: input.time });
  return { direction: input.direction, minutes, weekdays: plan.weekdays, time: plan.time };
}
function ruleSuggestion(input) {
  const normalized = validateInput(input), choice = DIRECTIONS.find(x => x.id === normalized.direction);
  const target = Math.min(normalized.minutes, 5);
  const draft = validateDraft({ title: choice.title, target, minimum: target > 1 ? Math.min(2, target - 1) : null,
    unit: '分钟', action: choice.action, reason: '先从短时间的小目标开始，做起来合适再调整。没有固定天数的养成保证。' }, normalized);
  return { source: 'rule', input: normalized, draft };
}
module.exports = { DIRECTIONS, validateInput, ruleSuggestion };
