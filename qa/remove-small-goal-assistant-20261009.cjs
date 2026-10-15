// 助手移除前后：隔离内存数据，只操作入口和表单，不保存习惯。
// before 参数仅用于删除前源码的历史截图；当前源码使用 after。
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const automator = require(path.join(process.env.TEMP, 'mp-automator/node_modules/miniprogram-automator'));
const { inject, restore, state } = require('./full-check-20261009.cjs');
const domain = require('../miniprogram/core/habits');
const { THEMES } = require('../miniprogram/config/theme-tokens');
const out = path.resolve(__dirname, '../docs/audits/2026-10-09-remove-small-goal-assistant');
const phase = process.argv[2] || 'after';
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9431' });
  const evidence = { phase, level: 'F', realWrites: 0, screenshots: [], checks: {}, exceptions: [] };
  mp.on('exception', event => evidence.exceptions.push(String(event.message || event).slice(0, 200)));
  async function show(route) {
    const p = await mp.reLaunch('/pages/' + route + '/index');
    await wait(600);
    return p;
  }
  async function shot(name) {
    await wait(1800);
    const file = phase + '-' + name + '.png';
    await mp.screenshot({ path: path.join(out, file) });
    evidence.screenshots.push(file);
    console.log(file);
  }
  async function routed(expected) {
    for (let attempt = 0; attempt < 20; attempt++) {
      const page = await mp.currentPage();
      if (page.path === expected) { await wait(700); return page; }
      await wait(250);
    }
    throw Error('Route did not become ' + expected);
  }
  try {
    await mp.evaluate(restore);
    await mp.evaluate(inject, { state, theme: 'mist', tokens: THEMES.mist });
    let p = await show('mine');
    if (phase === 'before') {
      assert.ok((await p.data()).assistantEnabled);
      await shot('01-mine');
      p = await show('assistant');
      assert.equal((await p.data()).directions.length, 4);
      await (await p.$('.rules-button')).tap();
      for (let i = 0; i < 20 && !(await p.data()).preview; i++) await wait(250);
      assert.equal((await p.data()).preview.source, 'rule');
      await shot('02-rules');
      evidence.checks.rulePreview = { target: (await p.data()).preview.draft.target, minimum: (await p.data()).preview.draft.minimum };
    } else {
      assert.equal((await p.data()).assistantEnabled, undefined);
      const rows = await p.$$('button.setting-row');
      for (const row of rows) assert.doesNotMatch(await row.text(), /小目标助手/);
      assert.equal(await mp.evaluate(() => typeof getApp().planAssistant), 'undefined');
      await shot('01-mine');
      p = await show('today');
      await (await p.$('.add-button')).tap(); await wait(500);
      assert.equal((await p.data()).chooserOpen, true);
      assert.equal(await p.$('.assistant-entry'), null);
      assert.equal((await p.$$('.tpl-card')).length, 4);
      await shot('02-add-templates');
      await (await p.$('[data-template="read"]')).tap();
      p = await routed('pages/edit/index');
      assert.equal((await p.data()).title, '读一会儿');
      assert.ok(await p.$('#minimum'));
      await shot('03-template-form');
      await mp.evaluate(inject, { state: domain.emptyState(), theme: 'mist', tokens: THEMES.mist });
      await show('progress'); p = await show('today');
      await (await p.$('.empty-create')).tap();
      p = await routed('pages/edit/index');
      assert.equal((await p.data()).title, '');
      assert.ok(await p.$('#minimum'));
      evidence.checks.customInputRects = await mp.evaluate(() => new Promise(resolve => {
        const query = wx.createSelectorQuery();
        ['#title', '#target', '#minimum'].forEach(selector => query.select(selector).boundingClientRect());
        query.exec(resolve);
      }));
      for (const rect of evidence.checks.customInputRects) assert.ok(rect && rect.width > 40 && rect.height >= 44);
      evidence.checks.assistantRouteRemoved = !require('../miniprogram/app.json').pages.includes('pages/assistant/index');
      assert.equal(evidence.checks.assistantRouteRemoved, true);
      await shot('04-custom-form');
      await show('progress');
      p = await mp.reLaunch('/pages/edit/index?draft=retired-local-token');
      await wait(700);
      assert.match((await p.data()).error, /入口已停用/);
      await p.callMethod('onSave');
      assert.match((await p.data()).error, /入口已停用/);
      await shot('05-retired-link');
      evidence.checks.manualAndTemplatesRemain = true;
      evidence.checks.retiredLinkCannotCreate = true;
    }
    evidence.checks.fixtureCommands = await mp.evaluate(() => globalThis.__fullReviewFixture.commands);
    assert.deepEqual(evidence.checks.fixtureCommands, []);
  } finally {
    await mp.evaluate(restore);
    await mp.reLaunch('/pages/today/index');
    evidence.checks.fixturePresentAfterRestore = await mp.evaluate(() => !!globalThis.__fullReviewFixture || !!globalThis.__fullReviewOriginal);
    fs.writeFileSync(path.join(out, phase + '-observations.json'), JSON.stringify(evidence, null, 2));
    await mp.disconnect();
  }
  console.log(JSON.stringify(evidence));
})().catch(error => { console.error(error.stack); process.exit(1); });
