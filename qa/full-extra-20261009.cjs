// 本轮补充截图：当前容量状态、日历下半屏及只读开关；仅内存夹具。
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const automator = require(path.join(process.env.TEMP, 'mp-automator/node_modules/miniprogram-automator'));
const { inject, restore, state } = require('./full-check-20261009.cjs');
const domain = require('../miniprogram/core/habits'), dates = require('../miniprogram/core/date');
const { THEMES } = require('../miniprogram/config/theme-tokens');
const out = path.resolve(__dirname, '../docs/audits/2026-10-09-full-review');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  const mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9431' });
  const evidence = JSON.parse(fs.readFileSync(path.join(out, 'observations.json'), 'utf8'));
  evidence.screenshots = evidence.screenshots.filter(step => step.step <= 34);
  let number = evidence.screenshots.length;
  const shot = async (p, name) => { const file = String(++number).padStart(2, '0') + '-' + name + '-F.png';
    await mp.screenshot({ path: path.join(out, file) }); evidence.screenshots.push({ step: number, file, route: p.path, supplemental: true }); console.log('CAPTURE ' + file); };
  const page = async route => { const p = await mp.reLaunch('/' + route); await wait(500); return p; };
  try {
    await mp.evaluate(restore); await mp.evaluate(inject, { state, theme: 'mist', tokens: THEMES.mist });
    let p = await page('pages/sync/index'); assert.equal((await p.data()).count, 4); await shot(p, 'sync-count-corrected');
    p = await page('pages/progress/index'); await mp.pageScrollTo(900); await wait(400); await shot(p, 'calendar7');
    await p.callMethod('onPeriod', { currentTarget: { dataset: { days: 28 } } }); await wait(400); await mp.pageScrollTo(980); await wait(300); await shot(p, 'calendar28');
    p = await page('pages/mine/index'); await mp.evaluate(() => { globalThis.__fullReviewFixture.mode = 'offline'; }); await p.callMethod('refresh');
    await wait(350); assert.equal((await p.data()).dataReadOnly, true); assert.equal(String(await (await p.$('switch')).attribute('disabled')), 'true'); await shot(p, 'mine-offline-switch');
    let full = domain.emptyState(); const day = dates.today();
    for (let i = 0; i < 5; i++) full = domain.reduce(full, { type: 'create', id: 'fixture-' + i, startDate: day,
      plan: { title: '已有习惯' + (i+1), target: 5, minimum: 2, unit: '分钟', weekdays: [1,2,3,4,5,6,7], time: '' } }, day);
    await mp.evaluate(inject, { state: full, theme: 'mist', tokens: THEMES.mist });
    p = await page('pages/edit/index?template=tidy'); assert.equal((await p.data()).capacityFull, true);
    await mp.pageScrollTo(650); await wait(400); await shot(p, 'edit-full-capacity');
    const tomorrow = domain.reduce(full, { type: 'status', id: 'fixture-0', status: 'paused', baseRevision: 1 }, day);
    await mp.evaluate(inject, { state: tomorrow, theme: 'mist', tokens: THEMES.mist });
    p = await page('pages/edit/index?template=tidy'); const d = await p.data(); assert.equal(d.startOffset, 1); assert.equal(d.draftDirty, false);
    await mp.pageScrollTo(620); await wait(400); await shot(p, 'edit-tomorrow-capacity');
    evidence.checks.capacityScreens = true;
  } finally {
    await mp.evaluate(restore); await mp.reLaunch('/pages/today/index');
    evidence.checks.fixturePresentAfterRestore = await mp.evaluate(() => !!globalThis.__fullReviewFixture || !!globalThis.__fullReviewOriginal);
    fs.writeFileSync(path.join(out, 'observations.json'), JSON.stringify(evidence, null, 2)); await mp.disconnect();
  }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
