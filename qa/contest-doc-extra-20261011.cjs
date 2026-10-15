// 补拍：双主题缺页、模板选择、已完成分组展开。夹具同 contest-doc-20261011。
const fs = require('node:fs'), path = require('node:path');
const automator = require(path.join(process.env.TEMP, 'mp-automator/node_modules/miniprogram-automator'));
const { inject, restore, history } = require('./contest-doc-20261011.cjs');
const { THEMES } = require('../miniprogram/config/theme-tokens');
const out = path.resolve(__dirname, '../docs/contest/captures');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  const mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:' + (process.env.MP_AUTO_PORT || 9431) });
  const problems = [];
  const shot = async (p, name) => {
    const file = name + '.png';
    await mp.screenshot({ path: path.join(out, file) });
    console.log('CAPTURE ' + file + '  ' + p.path);
  };
  const page = async route => { const p = await mp.reLaunch('/' + route); await wait(600); return p; };
  const tap = async (p, selector) => { const el = await p.$(selector); if (!el) throw Error('缺少 ' + selector); await el.tap(); await wait(450); };
  try {
    await mp.evaluate(restore);
    for (const theme of ['paper']) {
      await mp.evaluate(inject, { state: history, theme, tokens: THEMES[theme] });
      for (const route of ['pages/progress/index', 'pages/mine/index']) {
        const name = route.split('/')[1];
        try { await shot(await page(route), 'zz-' + name + '-' + theme); } catch (e) { problems.push(name + ': ' + e.message); }
      }
    }
    await mp.evaluate(inject, { state: history, theme: 'mist', tokens: THEMES.mist });
    let p = await page('pages/today/index');
    await tap(p, '.add-button');
    await shot(p, 'zz-today-chooser-mist');
    await tap(p, '.tpl-card[data-template="read"]');
    const confirm = await mp.currentPage();
    await wait(500);
    await shot(confirm, 'zz-template-confirm-mist');
    p = await page('pages/today/index');
    await tap(p, '#completed-section');
    await shot(p, 'zz-today-completed-mist');
    p = await page('pages/progress/index');
    await tap(p, '[data-tab="month"]').catch(() => {});
    const tabs = await p.$$('.tab-button, .tab, [data-tab]');
    console.log('progress tabs found: ' + tabs.length);
  } catch (error) { problems.push('flow: ' + error.message); }
  finally {
    try { await mp.evaluate(restore); await mp.reLaunch('/pages/today/index'); } catch (_) {}
    console.log(JSON.stringify({ problems }, null, 2));
    await mp.disconnect();
  }
})().catch(e => { console.error(e.stack); process.exitCode = 1; });
