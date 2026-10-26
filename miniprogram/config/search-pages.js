'use strict';

const { APP_NAME } = require('./brand');
const { getHabitTemplate } = require('./habit-templates');

const OVERVIEW_ROUTE = 'pages/discover/index';
const OVERVIEW_PATH = '/' + OVERVIEW_ROUTE;
const TEMPLATE_ROUTE = 'pages/template/index';
const STATIC_SHARE_IMAGE = '/assets/share/cover.png';
const PUBLIC_TEMPLATE_KEYS = Object.freeze(['read', 'walk', 'study', 'tidy']);

// 只有随代码提供的官方内容可以进入搜索页，不接收账户或用户快照。
const CONTENT = {
  read: {
    title: '阅读打卡计划', category: '阅读',
    summary: '选一本想读的书，给平常日和忙碌日各留一个阅读目标。',
    audience: '适合想给阅读留出固定时间，又希望忙时仍能继续的人。',
    suggestion: '先选定一本书或一篇文章，把材料放在容易拿到的地方。目标时长可以在确认页按自己的安排修改。',
    steps: ['先准备今天想读的内容，选择一个方便开始的时间。', '平时按阅读目标进行；时间紧时，完成忙时目标也可以记录。', '实际读完后再点打卡；想写感受时，可以在自己的习惯里留备注。'],
    example: '例如晚饭后读一会儿。当天比较忙，就挑一个小章节开始，做完所选目标后再打卡。'
  },
  walk: {
    title: '步行习惯计划', category: '步行',
    summary: '按自己的节奏安排一段步行时间，忙的时候也有一个小目标。',
    audience: '适合希望把日常步行放进计划，按实际完成情况做记录的人。',
    suggestion: '选择熟悉、方便的路线，根据自己的日程调整目标时长。小程序记录你主动确认的完成情况，不自动计步。',
    steps: ['选一段方便出发的时间和路线，把今天的目标想清楚。', '按自己的节奏完成平时目标或忙时目标。', '实际走完后再打卡，回到进度页查看近期的完成记录。'],
    example: '例如下班后走一会儿。当天时间有限时，可以选择忙时目标，完成后如实记录。'
  },
  study: {
    title: '学习复习计划', category: '学习',
    summary: '把复习缩成可开始的一小段，为平时和忙时分别安排目标。',
    audience: '适合想定期复习课程、笔记或知识点，希望安排清楚每次投入时间的人。',
    suggestion: '每次开始前选定一小段内容，例如几页笔记或一个知识点。可以在确认页调整目标和执行日期。',
    steps: ['挑选今天要复习的一小段内容，准备好笔记或材料。', '平时按计划复习；忙时聚焦一个小问题，完成所选目标。', '复习结束后再打卡，下一次继续安排自己的内容。'],
    example: '例如每天晚间复习当天笔记。忙时先回顾一个知识点，完成忙时目标后再记录。'
  },
  tidy: {
    title: '桌面整理计划', category: '整理',
    summary: '从一小块桌面开始，给日常整理留一个具体、可调整的目标。',
    audience: '适合想定期整理桌面，又不想每次都从大范围清理开始的人。',
    suggestion: '先划定一个小范围，例如工作桌面或一个抽屉。把物品归位、清理纸张等步骤安排在自己的目标时长内。',
    steps: ['选定今天要整理的一小块区域，准备好收纳位置。', '平时按目标整理；忙时先把最常用的一小块收好。', '实际完成所选目标后再打卡，下一次再继续其他区域。'],
    example: '例如收工前整理桌面。当天很忙，就先把常用物品归位，做完忙时目标后再打卡。'
  }
};

function templatePath(key) {
  return typeof key === 'string' && PUBLIC_TEMPLATE_KEYS.includes(key)
    ? '/' + TEMPLATE_ROUTE + '?key=' + key : OVERVIEW_PATH;
}

const SEARCH_TEMPLATES = Object.freeze(PUBLIC_TEMPLATE_KEYS.map(key => {
  const plan = getHabitTemplate(key), content = CONTENT[key];
  return Object.freeze({ ...content, steps: Object.freeze(content.steps), key,
    habitTitle: plan.title, target: plan.target, minimum: plan.minimum, unit: plan.unit,
    path: templatePath(key), navigationTitle: content.title + ' · 渐成',
    shareTitle: content.title + '：平时' + plan.target + plan.unit + '，忙时' + plan.minimum + plan.unit });
}));

function getSearchTemplate(key) {
  return typeof key === 'string' ? SEARCH_TEMPLATES.find(item => item.key === key) || null : null;
}

const INTRODUCTION = Object.freeze({
  title: APP_NAME, tagline: '平时按计划，忙时做一点',
  description: '为阅读、学习、步行和整理设定一个小目标，做完后主动打卡，逐步积累自己的习惯记录。',
  shareTitle: APP_NAME + '：忙的时候，也能做一点',
  steps: Object.freeze(['选一个模板，或自己填写习惯名称和目标。', '核对平时目标、忙时目标与执行日期，再确认创建。', '实际完成当天目标后主动打卡；小程序不会自动计时或累计数量。', '在进度页回看近期记录，按自己的情况继续安排。']),
  questions: Object.freeze([
    Object.freeze({ question: '忙的时候，怎么记录？', answer: '有忙时目标的习惯可以按忙时目标完成后打卡。也可以先到详情调整今天的目标；调整本身不会打卡，做完后再记录。' }),
    Object.freeze({ question: '打开模板会直接创建习惯吗？', answer: '不会。先进入确认页，可以调整名称、目标和执行日期；只有主动确认且云端保存成功后才会创建。' }),
    Object.freeze({ question: '打卡记录保存在哪里？', answer: '自己的记录保存到云端，同一微信账号换机后可以读取。断网时不能创建或修改记录；这里的介绍和官方模板仍可浏览。' })
  ])
});

module.exports = { OVERVIEW_ROUTE, OVERVIEW_PATH, TEMPLATE_ROUTE, STATIC_SHARE_IMAGE,
  PUBLIC_TEMPLATE_KEYS, SEARCH_TEMPLATES, INTRODUCTION, getSearchTemplate, templatePath };
