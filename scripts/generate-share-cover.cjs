'use strict';

// 固定的公开价值封面：不接收账户、私人名称、记录量或任何动态输入。
// SVG 为可审阅源，PNG 用于微信分享 imageUrl。渲染阶段使用已安装的 sharp，
// 可通过 NODE_PATH 指向工具环境的依赖；不进入小程序/云函数运行依赖。
const fs = require('node:fs');
const path = require('node:path');

const WIDTH = 1000;
const HEIGHT = 800;
const destination = path.resolve(__dirname, '../miniprogram/assets/share');

function renderSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <title>渐成：忙的时候，也能做一点</title>
  <desc>平时目标加忙时目标的通用价值封面，不包含私人信息或动态数量。</desc>
  <rect width="1000" height="800" fill="#F6F7F2"/>
  <rect x="48" y="48" width="904" height="704" rx="32" fill="#FFFFFF" stroke="#DBE2D9" stroke-width="2"/>
  <g font-family="Microsoft YaHei, PingFang SC, Noto Sans CJK SC, sans-serif">
    <rect x="88" y="104" width="44" height="5" rx="2.5" fill="#355E4C"/>
    <text x="88" y="177" fill="#355E4C" font-size="44" font-weight="600">渐成</text>
    <text x="88" y="308" fill="#25352D" font-size="76" font-weight="600">忙的时候，</text>
    <text x="88" y="408" fill="#25352D" font-size="76" font-weight="600">也能做一点</text>
    <rect x="88" y="518" width="356" height="142" rx="20" fill="#EEF2EC"/>
    <rect x="524" y="518" width="356" height="142" rx="20" fill="#EDF2E3"/>
    <text x="266" y="607" fill="#25352D" font-size="40" font-weight="500" text-anchor="middle">平时目标</text>
    <text x="484" y="607" fill="#5F6C63" font-size="42" font-weight="400" text-anchor="middle">+</text>
    <text x="702" y="607" fill="#4D6040" font-size="40" font-weight="500" text-anchor="middle">忙时目标</text>
  </g>
</svg>
`;
}

async function generate() {
  let sharp;
  try { sharp = require('sharp'); }
  catch (_) { throw Error('需要已安装的 sharp 渲染依赖；可通过 NODE_PATH 指向工具环境的 node_modules。'); }
  const svg = renderSvg();
  fs.mkdirSync(destination, { recursive: true });
  fs.writeFileSync(path.join(destination, 'cover.svg'), svg);
  await sharp(Buffer.from(svg)).png({ compressionLevel: 9, adaptiveFiltering: false }).toFile(path.join(destination, 'cover.png'));
  console.log(`PASS public share cover generated: ${WIDTH}x${HEIGHT}; SVG + PNG`);
}

if (require.main === module) generate().catch(error => { console.error(error.message); process.exitCode = 1; });

module.exports = { renderSvg, generate, destination, WIDTH, HEIGHT };
