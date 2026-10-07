// 本轮只读基线：真实页面截图，不触发生成/保存/云端写入。
const fs = require('node:fs');
const path = require('node:path');
const automator = require(path.join(process.env.TEMP, 'mp-automator/node_modules/miniprogram-automator'));
const out = path.resolve(__dirname, '../../docs/audits/2026-10-02-ai-ui');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9431' });
  try {
    for (const [name, route] of [['01-before-today-W','today'], ['02-before-mine-W','mine'], ['03-before-progress-W','progress']]) {
      await mp.reLaunch('/pages/' + route + '/index'); await sleep(1800);
      await mp.screenshot({ path: path.join(out, name + '.png') });
      console.log(name);
    }
  } finally { await mp.disconnect(); }
})().catch(e => { console.error(e.message); process.exitCode = 1; });
