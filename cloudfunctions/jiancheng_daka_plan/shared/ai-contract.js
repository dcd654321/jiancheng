const { validatePlan } = require('./habits');

/** Contract only. No model invocation, quota claim, or fake generation. */
function validateDraft(draft, input) {
  if (!draft || typeof draft !== 'object' || Array.isArray(draft)) throw Error('AI结果格式不正确');
  if (typeof draft.title !== 'string' || !Number.isInteger(draft.target) || (draft.minimum !== null && draft.minimum !== undefined && !Number.isInteger(draft.minimum))) throw Error('AI目标字段类型不正确');
  const budget = Number(input.minutes);
  if (!Number.isInteger(budget) || budget < 1 || budget > 60) throw Error('可用时长需要1—60分钟');
  if (draft.unit !== '分钟' || Number(draft.target) > budget) throw Error('AI建议超出可用时长或使用了错误单位');
  if (typeof draft.action !== 'string' || !draft.action.trim() || Array.from(draft.action).length > 100) throw Error('AI需要提供简短的具体动作');
  if (typeof draft.reason !== 'string' || Array.from(draft.reason).length > 100) throw Error('AI说明格式不正确');
  const unsafe = /保证.*(养成|治愈|成绩)|服药|药量|处方|极端节食|https?:\/\/|<script/i;
  if (unsafe.test([draft.title, draft.action, draft.reason].join(' '))) throw Error('该建议不适合直接采用');
  const minimum = Number(draft.minimum);
  const plan = validatePlan({ title: draft.title, target: draft.target, unit: '分钟',
    minimum: Number.isInteger(minimum) && minimum > 0 && minimum < Number(draft.target) ? minimum : null,
    weekdays: input.weekdays, time: input.time || '' });
  return { ...plan, action: draft.action.trim(), reason: draft.reason.trim() };
}

module.exports = { validateDraft };
