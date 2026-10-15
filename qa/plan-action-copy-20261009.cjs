// 调整计划文案：隔离内存场景，打开入口和表单，不保存计划。
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const automator = require(path.join(process.env.TEMP, 'mp-automator/node_modules/miniprogram-automator'));
const { inject, restore, state } = require('./full-check-20261009.cjs');
const { THEMES } = require('../miniprogram/config/theme-tokens');
const out = path.resolve(__dirname, '../docs/audits/2026-10-09-plan-action-copy');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9431' });
  const evidence = { level: 'F', realWrites: 0, checks: {}, exceptions: [] };
  mp.on('exception', event => evidence.exceptions.push(String(event.message || event).slice(0, 200)));
  try {
    await mp.evaluate(restore);
    await mp.evaluate(inject, { state, theme: 'mist', tokens: THEMES.mist });
    let p = await mp.reLaunch('/pages/progress/index'); await wait(1800);
    const buttons = await p.$$('.fact-adjust'); assert.ok(buttons.length);
    for (const button of buttons) assert.equal(await button.text(), '调整计划');
    await mp.evaluate(() => wx.pageScrollTo({ selector: '.habit-facts', duration: 0 })); await wait(1800);
    await mp.screenshot({ path: path.join(out, '01-progress.png') });
    await buttons[0].tap();
    for (let i = 0; i < 30; i++) {
      p = await mp.currentPage(); if (p.path === 'pages/edit/index') break; await wait(250);
    }
    assert.equal(p.path, 'pages/edit/index'); await wait(1800);
    assert.equal((await p.data()).editing, true);
    assert.equal(await (await p.$('.submit-bar .primary')).text(), '保存计划');
    assert.equal(await (await p.$('.submit-note')).text(), '修改从明天生效');
    await mp.screenshot({ path: path.join(out, '02-edit.png') });
    evidence.checks.progressTapEditsHabit = true;
    p = await mp.reLaunch('/pages/detail/index?id=fixture-read'); await wait(1800);
    assert.equal(await (await p.$('.actions button')).text(), '调整计划');
    evidence.checks.detailActionConsistent = true;
    evidence.checks.fixtureCommands = await mp.evaluate(() => globalThis.__fullReviewFixture.commands);
    assert.deepEqual(evidence.checks.fixtureCommands, []);
  } finally {
    await mp.evaluate(restore); await mp.reLaunch('/pages/today/index');
    evidence.checks.fixturePresentAfterRestore = await mp.evaluate(() => !!globalThis.__fullReviewFixture || !!globalThis.__fullReviewOriginal);
    fs.writeFileSync(path.join(out, 'observations.json'), JSON.stringify(evidence, null, 2));
    await mp.disconnect();
  }
  console.log(JSON.stringify(evidence));
})().catch(error => { console.error(error.stack); process.exit(1); });
