'use strict';

// 从 miniprogram/config/theme-tokens.js 生成 miniprogram/styles/theme.wxss。
// 业务样式只写一次，两套主题通过 .theme-mist / .theme-paper 作用域内的 CSS 变量切换。
// --check 模式只比较不写入，供 npm run check 防止生成物漂移。
const fs = require('node:fs');
const path = require('node:path');
const { THEMES, DEFAULT_THEME } = require('../miniprogram/config/theme-tokens');

const root = path.resolve(__dirname, '..');
const destination = path.join(root, 'miniprogram', 'styles', 'theme.wxss');
const check = process.argv.includes('--check');

const variable = name => '--color-' + name.replace(/[A-Z]/g, letter => '-' + letter.toLowerCase());
function scope(name, tokens) {
  const lines = Object.entries(tokens).map(([key, value]) => `  ${variable(key)}: ${value};`);
  return `.theme-${name} {\n${lines.join('\n')}\n}`;
}
function render() {
  return [
    '/* 由 scripts/build-themes.cjs 从 miniprogram/config/theme-tokens.js 生成，请勿手改。 */',
    '/* 页面根节点使用 theme-mist / theme-paper 作用域；未加载主题时回退薄雾绿缺省值。 */',
    scope(DEFAULT_THEME, THEMES[DEFAULT_THEME]),
    scope('paper', THEMES.paper),
    ''
  ].join('\n');
}

if (require.main === module) {
  const content = render();
  if (check) {
    if (!fs.existsSync(destination) || fs.readFileSync(destination, 'utf8') !== content) {
      throw Error('Stale theme scope: miniprogram/styles/theme.wxss. Run npm run build:themes.');
    }
    console.log('PASS theme scope matches miniprogram/config/theme-tokens.js.');
  } else {
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, content);
    console.log('PASS theme scope written to miniprogram/styles/theme.wxss.');
  }
}

module.exports = { render, destination };
