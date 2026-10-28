'use strict';

// 双主题语义 token 的唯一来源（薄雾绿 mist 为缺省，暖纸白 paper 只换语义颜色）。
// scripts/build-themes.cjs 从这里生成 miniprogram/styles/theme.wxss；
// 原生导航/Tab 的运行时配色也读取这里，业务 WXML/WXSS 不复制第二套结构。
const THEMES = Object.freeze({
  mist: Object.freeze({
    page: '#FFFFFF', surface: '#FFFFFF', ink: '#18382C', secondary: '#587065', primary: '#246446',
    onPrimary: '#FFFFFF', busyBg: '#EDF6EF', busyText: '#246446', soft: '#F7FAF7', line: '#DCE7DF', busyFill: '#C1DECB',
    controlBorder: '#7A897D', fieldBorder: '#C6D8CC', chartBorder: '#CBDACF', accentBorder: '#B6CDBF', error: '#A23C2E', errorBg: '#FFF1EC'
  }),
  paper: Object.freeze({
    page: '#FAF8F3', surface: '#FFFEFA', ink: '#39352F', secondary: '#70695F', primary: '#79604F',
    onPrimary: '#FFFFFF', busyBg: '#F0F1E7', busyText: '#606449', soft: '#F3F0EA', line: '#E6E0D6', busyFill: '#D4D6B9',
    controlBorder: '#998A7D', fieldBorder: '#C8BEB0', chartBorder: '#D9D4C8', accentBorder: '#C8BEB0', error: '#A33D2A', errorBg: '#FFF1EB'
  })
});
const DEFAULT_THEME = 'mist';
const THEME_NAMES = { mist: '薄雾绿', paper: '暖纸白' };

module.exports = { THEMES, DEFAULT_THEME, THEME_NAMES };
