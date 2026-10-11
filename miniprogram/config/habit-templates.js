'use strict';

// 新建、今日示例与主题预览共用；不会回写已有习惯或改变规则建议合同。
const HABIT_TEMPLATES = Object.freeze([
  Object.freeze({ key: 'read', title: '读一会儿', target: 30, minimum: 10, unit: '分钟' }),
  Object.freeze({ key: 'walk', title: '轻松走一会儿', target: 30, minimum: 10, unit: '分钟' }),
  Object.freeze({ key: 'study', title: '复习一小段', target: 30, minimum: 10, unit: '分钟' }),
  Object.freeze({ key: 'tidy', title: '整理桌面', target: 15, minimum: 5, unit: '分钟' })
]);

function getHabitTemplate(key) {
  return HABIT_TEMPLATES.find(item => item.key === key) || null;
}

function templatePlan(key) {
  const item = getHabitTemplate(key);
  return item ? { title: item.title, target: String(item.target), minimum: String(item.minimum), unit: item.unit } : null;
}

module.exports = { HABIT_TEMPLATES, getHabitTemplate, templatePlan };
