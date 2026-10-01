// 同页同内容的双主题 A/B 对比（注入控制器与夹具状态，不写云端）。
const path = require('node:path');
const automator = require(path.join(process.env.TEMP, 'mp-automator', 'node_modules', 'miniprogram-automator'));
const domain = require('../../miniprogram/core/habits');
const dates = require('../../miniprogram/core/date');
const { THEMES } = require('../../miniprogram/config/theme-tokens');
const OUT = path.resolve(__dirname, '..', '..', 'docs', 'audits', '2026-09-30-journey-themes');
const PREFIX = process.argv[2] || 'A28-ab';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const today = dates.today();
function stateWith() {
  let state = domain.emptyState();
  const start = dates.shift(today, -6);
  state = domain.reduce(state, { type: 'create', id: 'read', startDate: start, plan: { title: '读一会儿', target: 5, minimum: 2, unit: '分钟', time: '', weekdays: [1,2,3,4,5,6,7] } }, start);
  for (const offset of [1,2,3,4,5]) state = domain.reduce(state, { type: 'complete', id: 'read', date: dates.shift(today, -offset) }, dates.shift(today, -offset));
  return state;
}
const INJECT_STORE = (payload) => {
  const app = getApp(); if (!globalThis.__origStore) globalThis.__origStore = app.store;
  const state = payload.state;
  app.store = { read: () => JSON.parse(JSON.stringify(state)),
    info: () => ({ source: 'cloud', ready: true, phase: 'ready', pending: 0, deletionPending: false, conflict: null, lastError: '', lastSyncedAt: '', syncText: '云端数据已确认', syncAttention: false }),
    contextKey: () => 'inject:ab', stale: () => null, dispatch: () => JSON.parse(JSON.stringify(state)) };
};
const INJECT_THEME = (payload) => {
  const app = getApp(); if (!globalThis.__origAppearance) globalThis.__origAppearance = app.appearanceController;
  const listeners = new Set(); let saved = payload.theme;
  const view = () => ({ theme: saved, revision: 0, enabled: true, key: 'inject:ab', loadState: 'ready', loadError: '', pendingTheme: '', themeName: saved === 'paper' ? '暖纸白' : '薄雾绿' });
  app.appearanceController = { view, subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); }, ensureRead: () => Promise.resolve(view()), current: () => saved, save: () => Promise.resolve(view()), replay: () => Promise.resolve(view()), invalidate() {} };
};
(async () => {
  const miniProgram = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9431' });
  await miniProgram.evaluate(INJECT_STORE, { state: stateWith() });
  for (const theme of ['mist', 'paper']) {
    await miniProgram.evaluate(INJECT_THEME, { theme });
    await miniProgram.reLaunch('/pages/progress/index');
    await sleep(1800);
    await miniProgram.screenshot({ path: path.join(OUT, `${PREFIX}-progress-${theme}-w390.png`) });
    await miniProgram.reLaunch('/pages/edit/index?template=read');
    await sleep(1600);
    await miniProgram.screenshot({ path: path.join(OUT, `${PREFIX}-edit-${theme}-w390.png`) });
    console.log('captured', theme);
  }
  // 采集结束必须恢复真实控制器与存储，避免注入残留污染共享的工具实例。
  await miniProgram.evaluate(() => {
    const app = getApp();
    if (globalThis.__origAppearance) app.appearanceController = globalThis.__origAppearance;
    if (globalThis.__origStore) app.store = globalThis.__origStore;
    if (app.appearanceController && app.appearanceController.ensureRead) app.appearanceController.ensureRead(true);
  });
  await sleep(1200);
  console.log('restored real controller/store');
  process.exit(0);
})().catch(err => { console.error('FAIL', err && err.message || err); process.exit(1); });
