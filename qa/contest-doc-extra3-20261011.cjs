// 补拍：今日已完成分组（滚动后）。夹具同 contest-doc-20261011。
const path = require('node:path');
const automator = require(path.join(process.env.TEMP, 'mp-automator/node_modules/miniprogram-automator'));
const { inject, restore, history } = require('./contest-doc-20261011.cjs');
const { THEMES } = require('../miniprogram/config/theme-tokens');
const out = path.resolve(__dirname, '../docs/contest/captures');
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:' + (process.env.MP_AUTO_PORT || 9431) });
  try {
    await mp.evaluate(restore);
    for (const theme of ['mist', 'paper']) {
      await mp.evaluate(inject, { state: history, theme, tokens: THEMES[theme] });
      const p = await mp.reLaunch('/pages/today/index'); await wait(700);
      await p.callMethod('onToggleCompleted'); await wait(500);
      await mp.pageScrollTo(600); await wait(600);
      const file = '29-today-completed-' + theme + '.png';
      await mp.screenshot({ path: path.join(out, file) });
      console.log('CAPTURE ' + file);
    }
  } finally {
    try { await mp.evaluate(restore); await mp.reLaunch('/pages/today/index'); } catch (_) {}
    await mp.disconnect();
  }
})().catch(e => { console.error(e.stack); process.exitCode = 1; });
