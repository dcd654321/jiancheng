'use strict';

// 双主题语义 token 的唯一来源（薄雾绿 mist 为缺省，暖纸白 paper 只换语义颜色）。
// scripts/build-themes.cjs 从这里生成 miniprogram/styles/theme.wxss；
// 原生导航/Tab 的运行时配色也读取这里，业务 WXML/WXSS 不复制第二套结构。
const THEMES = Object.freeze({
  mist: Object.freeze({
    page: '#F6F7F2', surface: '#FFFFFF', ink: '#25352D', secondary: '#5F6C63', primary: '#355E4C',
    onPrimary: '#FFFFFF', busyBg: '#EDF2E3', busyText: '#4D6040', soft: '#EEF2EC', line: '#DBE2D9',
    controlBorder: '#7A897D', error: '#A23C2E', errorBg: '#FFF1EC'
  }),
  paper: Object.freeze({
    page: '#FAF8F3', surface: '#FFFEFA', ink: '#39352F', secondary: '#70695F', primary: '#79604F',
    onPrimary: '#FFFFFF', busyBg: '#F0F1E7', busyText: '#606449', soft: '#F3F0EA', line: '#E6E0D6',
    controlBorder: '#998A7D', error: '#A33D2A', errorBg: '#FFF1EB'
  })
});
const DEFAULT_THEME = 'mist';
const THEME_NAMES = { mist: '薄雾绿', paper: '暖纸白' };

module.exports = { THEMES, DEFAULT_THEME, THEME_NAMES };
