// A01/A02：开发者工具中真实渲染读取中/失败/恢复流程（注入一次失败的读取，按钮触发真实恢复）。
const path = require('node:path');
const automator = require(path.join(process.env.TEMP, 'mp-automator', 'node_modules', 'miniprogram-automator'));

const OUT = path.resolve(__dirname, '..', '..', 'docs', 'audits', '2026-09-30-journey-themes');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const INJECT_FLAKY = (payload) => {
  const app = getApp();
  if (!globalThis.__origStore) globalThis.__origStore = app.store;
  const real = globalThis.__origStore;
  let failures = payload.failures;
  app.store = {
    read: () => { if (failures > 0) { failures -= 1; const err = Error('暂时无法读取记录（注入的失败态，仅本次）'); err.code = 'DATA_UNAVAILABLE'; throw err; } return real.read(); },
    info: () => { if (failures > 0) return { source: 'cloud', ready: false, phase: 'offline', pending: 0, syncText: '离线', syncAttention: true, lastError: '注入的失败态' }; return real.info(); },
    contextKey: () => real.contextKey(),
    stale: () => null,
    dispatch: command => real.dispatch(command)
  };
};
const INJECT_LOADING = () => {
  const app = getApp();
  if (!globalThis.__origStore) globalThis.__origStore = app.store;
  const real = globalThis.__origStore;
  app.store = {
    read: () => { const err = Error('正在读取云端记录'); err.code = 'DATA_LOADING'; throw err; },
    info: () => ({ source: 'cloud', ready: false, phase: 'loading', pending: 0, syncText: '正在读取云端', syncAttention: false }),
    contextKey: () => real.contextKey(),
    stale: () => null,
    dispatch: command => real.dispatch(command)
  };
};
const RESTORE_STORE = () => { const app = getApp(); if (globalThis.__origStore) app.store = globalThis.__origStore; };

(async () => {
  const miniProgram = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9431' });
  const shot = async (name) => { const file = path.join(OUT, `${name}-w390.png`); await miniProgram.screenshot({ path: file }); console.log('shot', path.basename(file)); };

  // A01 首次读取中：中性占位，不显示空账户结论
  await miniProgram.evaluate(INJECT_LOADING);
  await miniProgram.reLaunch('/pages/progress/index');
  await sleep(1200);
  await shot('A01-progress-loading-mist-inject');

  // A02 读取失败 → 可见恢复按钮；恢复通道后点击“重新读取”，按钮驱动真实 session.start 与原地刷新
  await miniProgram.evaluate(INJECT_FLAKY, { failures: 99 });
  await miniProgram.reLaunch('/pages/progress/index');
  await sleep(1400);
  await shot('A02-progress-unavailable-mist-inject');
  const page = await miniProgram.currentPage();
  const data = await page.data();
  console.log('unavailable', data.dataUnavailable, 'label', data.recoveryLabel, 'error', data.error);
  // 恢复通道（模拟网络恢复），随后由页面自身的“重新读取”完成原地恢复
  await miniProgram.evaluate(RESTORE_STORE);
  const retry = await page.$('.empty .primary');
  await retry.tap();
  await sleep(2200);
  await shot('A02-progress-recovered-mist-inject');
  const after = await page.data();
  console.log('after retry', JSON.stringify({ ready: after.dataReady, unavailable: after.dataUnavailable, error: after.error }));

  await miniProgram.reLaunch('/pages/today/index');
  await sleep(1200);
  console.log('done');
  process.exit(0);
})().catch(err => { console.error('FAIL', err && err.message || err, err && err.stack || ''); process.exit(1); });
