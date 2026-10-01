// 主题服务联通后的页面状态证据（只读）。
const path = require('node:path');
const automator = require(path.join(process.env.TEMP, 'mp-automator', 'node_modules', 'miniprogram-automator'));
const OUT = path.resolve(__dirname, '..', '..', 'docs', 'audits', '2026-09-30-journey-themes');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  const miniProgram = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9431' });
  await miniProgram.evaluate(() => { const c = getApp().appearanceController; return c && c.ensureRead(true); });
  await sleep(2000);
  const view = await miniProgram.evaluate(() => JSON.stringify(getApp().appearanceController.view()));
  console.log('controller.view:', view);
  await miniProgram.reLaunch('/pages/mine/index');
  await sleep(2200);
  const mine = await miniProgram.currentPage();
  console.log('mine:', JSON.stringify(await mine.data()).slice(0, 260));
  await miniProgram.screenshot({ path: path.join(OUT, 'A29-mine-theme-entry-live-w390.png') });
  await miniProgram.navigateTo('/pages/appearance/index');
  await sleep(2600);
  const page = await miniProgram.currentPage();
  const data = await page.data();
  console.log('appearance:', JSON.stringify({ enabled: data.enabled, hasRevision: data.hasRevision, savedTheme: data.savedTheme,
    primaryLabel: data.primaryLabel, primaryDisabled: data.primaryDisabled, statusNote: data.statusNote }));
  await miniProgram.screenshot({ path: path.join(OUT, 'A29-appearance-live-w390.png') });
  console.log('shots saved');
  process.exit(0);
})().catch(err => { console.error('FAIL', err && err.message || err); process.exit(1); });
