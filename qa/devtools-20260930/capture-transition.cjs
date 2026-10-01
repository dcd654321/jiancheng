// 验证客户端开关打开、云端尚未启用时的过渡状态（真实云调用被拒绝后的降级表现）。
const path = require('node:path');
const automator = require(path.join(process.env.TEMP, 'mp-automator', 'node_modules', 'miniprogram-automator'));

const OUT = path.resolve(__dirname, '..', '..', 'docs', 'audits', '2026-09-30-journey-themes');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  const miniProgram = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9431' });
  const shot = async (name) => { const file = path.join(OUT, `${name}-w390.png`); await miniProgram.screenshot({ path: file }); console.log('shot', path.basename(file)); };

  await miniProgram.reLaunch('/pages/mine/index');
  await sleep(2600);
  const mine = await miniProgram.currentPage();
  const mineData = await mine.data();
  console.log('mine appearanceEnabled =', mineData.appearanceEnabled, 'label =', mineData.appearanceLabel);
  await shot('A27-mine-entry-visible-client-on-server-off');

  await miniProgram.navigateTo('/pages/appearance/index');
  await sleep(2600);
  const page = await miniProgram.currentPage();
  const data = await page.data();
  console.log(JSON.stringify({ enabled: data.enabled, hasRevision: data.hasRevision, primaryDisabled: data.primaryDisabled,
    primaryLabel: data.primaryLabel, statusNote: data.statusNote, saveError: data.saveError }));
  await shot('A27-appearance-client-on-server-off');
  process.exit(0);
})().catch(err => { console.error('FAIL', err && err.message || err); process.exit(1); });
