const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { THEMES, THEME_NAMES, DEFAULT_THEME } = require('../miniprogram/config/theme-tokens');

function channel(value) {
  const v = value / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}
function luminance(hex) {
  const value = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map(index => parseInt(value.slice(index, index + 2), 16));
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
function contrast(a, b) {
  const [one, two] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (one + 0.05) / (two + 0.05);
}

test('two documented themes share one semantic shape and the documented values', () => {
  assert.equal(DEFAULT_THEME, 'mist');
  assert.deepEqual(Object.keys(THEMES), ['mist', 'paper']);
  assert.deepEqual(Object.keys(THEMES.mist), Object.keys(THEMES.paper), '两套主题使用同一组语义 token');
  assert.deepEqual(THEME_NAMES, { mist: '薄雾绿', paper: '暖纸白' });
  assert.deepEqual(THEMES.mist, {
    page: '#F7F8F5', surface: '#FFFFFF', ink: '#303A34', secondary: '#647067', primary: '#486557',
    onPrimary: '#FFFFFF', busyBg: '#EDF1E2', busyText: '#536343', soft: '#F1F4EF', line: '#E2E7DF',
    controlBorder: '#819086', error: '#A33D2A', errorBg: '#FFF1EB'
  });
  assert.deepEqual(THEMES.paper, {
    page: '#FAF8F3', surface: '#FFFEFA', ink: '#39352F', secondary: '#70695F', primary: '#79604F',
    onPrimary: '#FFFFFF', busyBg: '#F0F1E7', busyText: '#606449', soft: '#F3F0EA', line: '#E6E0D6',
    controlBorder: '#998A7D', error: '#A33D2A', errorBg: '#FFF1EB'
  });
});

test('contrast stays readable in every documented combination for both themes', () => {
  for (const [name, tokens] of Object.entries(THEMES)) {
    const pairs = [
      ['ink on page', tokens.ink, tokens.page, 4.5],
      ['ink on surface', tokens.ink, tokens.surface, 4.5],
      ['secondary on page', tokens.secondary, tokens.page, 4.5],
      ['secondary on surface', tokens.secondary, tokens.surface, 4.5],
      ['secondary on soft', tokens.secondary, tokens.soft, 4.5],
      ['primary on surface', tokens.primary, tokens.surface, 4.5],
      ['onPrimary on primary', tokens.onPrimary, tokens.primary, 4.5],
      ['busy text on busy label', tokens.busyText, tokens.busyBg, 4.5],
      ['error on error background', tokens.error, tokens.errorBg, 4.5],
      ['control border on surface', tokens.controlBorder, tokens.surface, 3],
      ['control border on page', tokens.controlBorder, tokens.page, 3]
    ];
    for (const [label, foreground, background, minimum] of pairs) {
      const ratio = contrast(foreground, background);
      assert.ok(ratio >= minimum, `${name} ${label} 对比度 ${ratio.toFixed(2)} 应不低于 ${minimum}:1`);
    }
    // 忙时标签是普通小字，同样按 4.5:1 要求；装饰线不承担唯一控件边界。
    assert.ok(contrast(tokens.line, tokens.page) < 3, `${name} 分隔线是装饰线，不作为控件边界`);
  }
});

test('active styles avoid the loud legacy colors and keep the accessibility floor', () => {
  const styles = fs.readFileSync(path.resolve(__dirname, '../miniprogram/app.wxss'), 'utf8').toLowerCase();
  for (const legacy of ['#245c44', '#ddf3a4', '#f0f7dc', '#edf3ed']) {
    assert.ok(!styles.includes(legacy), '不再整片使用旧版浓色 ' + legacy);
  }
  assert.match(styles, /--color-busy-bg/);
  // 重复同一处说明：正文16、辅助14、按钮最小高度48、触区44。
  assert.match(styles, /\.sub \{ font-size: 14px/);
  assert.match(styles, /\.heading \{ font-size: 26px/);
  assert.match(styles, /min-height: 44px/);
  assert.match(styles, /min-height: 48px/);
  for (const page of ['today', 'edit', 'progress', 'mine', 'appearance']) {
    const markup = fs.readFileSync(path.resolve(__dirname, '../miniprogram/pages/' + page + '/index.wxml'), 'utf8');
    assert.doesNotMatch(markup, /style="[^"]*#245[cC]44/, page + ' 不再内联旧绿色');
  }
});

test('the generated theme scope matches its single token source', () => {
  const { render, destination } = require('../scripts/build-themes.cjs');
  assert.ok(fs.existsSync(destination), '主题作用域已生成');
  assert.equal(fs.readFileSync(destination, 'utf8'), render(), '生成物与 token 源一致（npm run build:themes）');
});

test('theme switching keeps tab and navigation colors readable through official APIs only', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../miniprogram/services/appearance.js'), 'utf8');
  for (const api of ['setNavigationBarColor', 'setTabBarStyle', 'setTabBarItem', 'setBackgroundColor']) {
    assert.ok(source.includes(api), '使用官方 ' + api);
  }
  assert.doesNotMatch(source, /setStorage|getStorage|setTabBarBadge/);
  const app = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../miniprogram/app.json'), 'utf8'));
  assert.equal(app.window.navigationBarTextStyle, 'black', '两主题均使用黑色导航字');
  assert.equal(app.tabBar.color, THEMES.mist.secondary);
  assert.equal(app.tabBar.selectedColor, THEMES.mist.primary);
  for (const tab of app.tabBar.list) {
    for (const field of ['iconPath', 'selectedIconPath']) {
      assert.ok(fs.existsSync(path.resolve(__dirname, '../miniprogram', tab[field])), tab[field] + ' 存在');
    }
  }
});
