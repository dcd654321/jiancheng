// 补拍：模板带入确认表单、今日已完成分组展开。
const path = require('node:path');
const automator = require(path.join(process.env.TEMP, 'mp-automator/node_modules/miniprogram-automator'));
const { inject, restore, history } = require('./contest-doc-20261011.cjs');
const { THEMES } = require('../miniprogram/config/theme-tokens');
const out = path.resolve(__dirname, '../docs/contest/captures');
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:' + (process.env.MP_AUTO_PORT || 9431) });
  const shot = async (file, note) => { await mp.screenshot({ path: path.join(out, file) }); console.log('CAPTURE ' + file + '  ' + note); };
  try {
    await mp.evaluate(restore);
    await mp.evaluate(inject, { state: history, theme: 'mist', tokens: THEMES.mist });
    let p = await mp.reLaunch('/pages/edit/index?template=read'); await wait(800);
    await shot('26-template-confirm-mist.png', p.path);
    p = await mp.reLaunch('/pages/today/index'); await wait(700);
    await p.callMethod('onToggleCompleted'); await wait(500);
    await shot('27-today-completed-expanded-mist.png', p.path);
    p = await mp.reLaunch('/pages/progress/index'); await wait(800);
    await shot('28-progress-initial-mist.png', p.path);
  } finally {
    try { await mp.evaluate(restore); await mp.reLaunch('/pages/today/index'); } catch (_) {}
    await mp.disconnect();
  }
})().catch(e => { console.error(e.stack); process.exitCode = 1; });
