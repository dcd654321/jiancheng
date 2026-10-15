// 本轮视觉修复补拍：只使用内存夹具，始终恢复原应用服务。
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const automator = require(path.join(process.env.TEMP, 'mp-automator/node_modules/miniprogram-automator'));
const { inject, restore, state } = require('./full-check-20261009.cjs');
const domain = require('../miniprogram/core/habits');
const { THEMES } = require('../miniprogram/config/theme-tokens');
const out = path.resolve(__dirname, '../docs/audits/2026-10-09-full-review');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  const mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9431' });
  const evidence = JSON.parse(fs.readFileSync(path.join(out, 'observations.json'), 'utf8'));
  try {
    await mp.evaluate(restore);
    await mp.evaluate(inject, { state: domain.emptyState(), theme: 'mist', tokens: THEMES.mist });
    let p = await mp.reLaunch('/pages/today/index'); await wait(800);
    assert.equal((await p.data()).hasHabits, false);
    assert.ok(await p.$('.tpl-goal'));
    await mp.screenshot({ path: path.join(out, '22-first-empty-F.png') });
    await mp.evaluate(inject, { state, theme: 'mist', tokens: THEMES.mist });
    p = await mp.reLaunch('/pages/today/index'); await wait(400);
    await mp.evaluate(() => { globalThis.__fullReviewFixture.mode = 'loading'; });
    await p.callMethod('refresh'); await wait(500);
    assert.equal((await p.data()).loading, true);
    await mp.screenshot({ path: path.join(out, '32-loading-F.png') });
    evidence.checks.visualFixesRecaptured = [22, 32];
  } finally {
    await mp.evaluate(restore); await mp.reLaunch('/pages/today/index');
    evidence.checks.fixturePresentAfterRestore = await mp.evaluate(() => !!globalThis.__fullReviewFixture || !!globalThis.__fullReviewOriginal);
    fs.writeFileSync(path.join(out, 'observations.json'), JSON.stringify(evidence, null, 2));
    await mp.disconnect();
  }
  console.log(JSON.stringify(evidence.checks));
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
