// 受控连通验证：确认云端 getAppearance 已启用、返回合法回执，并核对页面状态（只读，不写入）。
const path = require('node:path');
const automator = require(path.join(process.env.TEMP, 'mp-automator', 'node_modules', 'miniprogram-automator'));

const OUT = path.resolve(__dirname, '..', '..', 'docs', 'audits', '2026-09-30-journey-themes');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  const miniProgram = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9431' });
  console.log('connected');
  await miniProgram.reLaunch('/pages/today/index');
  await sleep(3000);

  // 协议层：直接调用客户端的 getAppearance（只读），打印真实回执
  await miniProgram.evaluate(() => { globalThis.__appearanceProbe = 'pending'; });
  await miniProgram.evaluate(() => {
    const app = getApp();
    const client = app.appearanceClient;
    if (!client) { globalThis.__appearanceProbe = 'no-client'; return; }
    globalThis.__appearanceProbe = 'pending';
    Promise.resolve(client.read(true)).then(
      value => { globalThis.__appearanceProbe = JSON.stringify({ ok: true, value }); },
      err => { globalThis.__appearanceProbe = JSON.stringify({ ok: false, code: err.code || '', message: err.message }); }
    );
  });
  await sleep(2500);
  console.log('getAppearance:', await miniProgram.evaluate(() => globalThis.__appearanceProbe));

  const controller = await miniProgram.evaluate(() => JSON.stringify(getApp().appearanceController.view()));
  console.log('controller.view:', controller);

  await miniProgram.reLaunch('/pages/mine/index');
  await sleep(2200);
  const mine = await miniProgram.currentPage();
  console.log('mine:', JSON.stringify(await mine.data()));
  const mineShot = path.join(OUT, 'A29-mine-theme-entry-real-w390.png');
  await miniProgram.screenshot({ path: mineShot });
  console.log('shot', path.basename(mineShot));

  await miniProgram.navigateTo('/pages/appearance/index');
  await sleep(2600);
  const page = await miniProgram.currentPage();
  const data = await page.data();
  console.log('appearance:', JSON.stringify({ enabled: data.enabled, hasRevision: data.hasRevision,
    savedTheme: data.savedTheme, primaryLabel: data.primaryLabel, primaryDisabled: data.primaryDisabled,
    statusNote: data.statusNote, loadState: data.loadState, saveError: data.saveError }));
  const pageShot = path.join(OUT, 'A29-appearance-ready-real-w390.png');
  await miniProgram.screenshot({ path: pageShot });
  console.log('shot', path.basename(pageShot));
  process.exit(0);
})().catch(err => { console.error('FAIL', err && err.message || err); process.exit(1); });
