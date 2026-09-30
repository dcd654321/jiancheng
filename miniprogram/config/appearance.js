'use strict';

// 外观主题能力开关：用户指示打开（2026-09-30）。
// 服务端对应 HABIT_APPEARANCE_ENABLED（jiancheng_daka_features 环境变量），仍需单独启用并部署；
// 客户端开关只是入口提示，不是鉴权——云端未启用时页面会显示“外观主题服务尚未开放”，保存被禁用。
// 独立于 features/分享/提醒/AI 门控：打开本开关不会连带开放其他能力。
module.exports = { enabled: true };
