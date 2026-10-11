// 用 headless Chrome 把说明文档 HTML 打印为参赛要求的 PDF。
// 用法：node docs/contest/build-pdf.cjs
// 依赖本机已安装 Chrome；截图来自 docs/contest/captures/。
const { execFileSync } = require('node:child_process');
const fs = require('node:fs'), path = require('node:path');

const dir = __dirname;
const html = path.join(dir, '渐成习惯打卡-说明文档.html');
const pdf = path.join(dir, '渐成习惯打卡-说明文档.pdf');
const candidates = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  process.env.CHROME_PATH
].filter(Boolean);
const chrome = candidates.find(file => fs.existsSync(file));
if (!chrome) throw new Error('未找到 Chrome，可用 CHROME_PATH 指定可执行文件路径。');

const url = 'file:///' + encodeURI(html.replace(/\\/g, '/')).replace(/#/g, '%23');
execFileSync(chrome, ['--headless', '--disable-gpu', '--no-pdf-header-footer', '--print-to-pdf=' + pdf, url],
  { stdio: ['ignore', 'inherit', 'inherit'] });
console.log('PDF 已生成：' + pdf + '  ' + (fs.statSync(pdf).size / 1048576).toFixed(2) + ' MB');
