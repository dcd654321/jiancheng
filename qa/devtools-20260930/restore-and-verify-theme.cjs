// 恢复被测试脚本注入替换的真实控制器/存储，并用真实云端链路验证主题切换与 Toast 文案。
const path = require('node:path');
const automator = require(path.join(process.env.TEMP, 'mp-automator', 'node_modules', 'miniprogram-automator'));
const OUT = path.resolve(__dirname, '..', '..', 'docs', 'audits', '2026-09-30-journey-themes');
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const miniProgram = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9431' });
  // 恢复真实对象并清理拦截
  await miniProgram.evaluate(() => {
    const app = getApp();
    if (globalThis.__origAppearance) app.appearanceController = globalThis.__origAppearance;
    if (globalThis.__origStore) app.store = globalThis.__origStore;
    if (globalThis.__origShowToast) wx.showToast = globalThis.__origShowToast;
    globalThis.__toasts = [];
  });
  await miniProgram.evaluate(() => { wx.showToast = (o) => { globalThis.__toasts.push(o && o.title); }; getApp().appearanceController.ensureRead(true); });
  await sleep(2200);
  await miniProgram.reLaunch('/pages/appearance/index');
  await sleep(2500);
  const page = await miniProgram.currentPage();
  let d = await page.data();
  console.log('initial(real):', JSON.stringify({ savedTheme: d.savedTheme, preview: d.preview, hasRevision: d.hasRevision, pendingTheme: d.pendingTheme }));
  for (const step of ['switch1', 'switch2']) {
    const target = d.savedTheme === 'paper' ? 'mist' : 'paper';
    const cards = await page.$$('.theme-card');
    await cards[target === 'paper' ? 1 : 0].tap();
    await sleep(500);
    const primary = await page.$('.primary');
    await primary.tap();
    await sleep(400);
    await miniProgram.screenshot({ path: path.join(OUT, `A29-toast-${target}-live-w390.png`) });
    await sleep(1600);
    d = await page.data();
    const toasts = JSON.parse(await miniProgram.evaluate(() => JSON.stringify(globalThis.__toasts)));
    console.log(`${step} -> ${target}:`, JSON.stringify({ savedTheme: d.savedTheme, preview: d.preview, primaryLabel: d.primaryLabel, toasts: toasts.slice(-1) }));
  }
  await miniProgram.evaluate(() => { wx.showToast = globalThis.__origShowToast || wx.showToast; });
  process.exit(0);
})().catch(err => { console.error('FAIL', err && err.message || err); process.exit(1); });
