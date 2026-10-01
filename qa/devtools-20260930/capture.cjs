// 微信开发者工具证据采集：真实云会话状态（W）+ 注入状态渲染（F）。
// 用法：先执行 cli auto --project <repo> --auto-port 9431，再运行本脚本。
// 注入只改开发者工具运行内存中的 getApp().store / appearanceController，不写云端、不改源码。
const path = require('node:path');
const fs = require('node:fs');
const automator = require(path.join(process.env.TEMP, 'mp-automator', 'node_modules', 'miniprogram-automator'));
const domain = require('../../miniprogram/core/habits');
const dates = require('../../miniprogram/core/date');
const { THEMES } = require('../../miniprogram/config/theme-tokens');

const OUT = path.resolve(__dirname, '..', '..', 'docs', 'audits', '2026-09-30-journey-themes');
fs.mkdirSync(OUT, { recursive: true });
const today = dates.today();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function plan(overrides = {}) {
  return { title: '读一会儿', target: 5, minimum: 2, unit: '分钟', time: '', weekdays: [1,2,3,4,5,6,7], ...overrides };
}
function stateWith({ habits = [], records = [], back = 1 } = {}) {
  let state = domain.emptyState();
  for (const [id, overrides] of habits) {
    const start = dates.shift(today, -back);
    state = domain.reduce(state, { type: 'create', id, startDate: start, plan: plan(overrides) }, start);
  }
  for (const command of records) state = domain.reduce(state, command, command.date);
  return state;
}

// —— 注入函数（在开发者工具 AppService 上下文中执行；参数只走 JSON） ——
const INJECT_STORE = (payload) => {
  const app = getApp();
  if (!globalThis.__origStore) globalThis.__origStore = app.store;
  let index = 0;
  const current = () => payload.states[Math.min(index, payload.states.length - 1)];
  app.store = {
    read: () => JSON.parse(JSON.stringify(current())),
    info: () => ({ source: 'cloud', ready: true, phase: 'ready', pending: 0, deletionPending: false, conflict: null,
      lastError: '', lastSyncedAt: '', syncText: '云端数据已确认', syncAttention: false }),
    contextKey: () => 'inject:1',
    stale: () => null,
    dispatch: () => { if (index < payload.states.length - 1) index += 1; return JSON.parse(JSON.stringify(current())); }
  };
};
const RESTORE_STORE = () => { const app = getApp(); if (globalThis.__origStore) app.store = globalThis.__origStore; };
const INJECT_APPEARANCE = (payload) => {
  const app = getApp();
  if (!globalThis.__origAppearance) globalThis.__origAppearance = app.appearanceController;
  const listeners = new Set();
  let saved = payload.theme || 'mist';
  const view = () => ({ theme: saved, revision: 0, enabled: true, key: 'inject:appearance', loadState: 'ready',
    loadError: '', pendingTheme: '', themeName: saved === 'paper' ? '暖纸白' : '薄雾绿' });
  app.appearanceController = {
    view,
    subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    ensureRead: () => Promise.resolve(view()),
    current: () => saved,
    save: (theme) => new Promise(resolve => setTimeout(() => { saved = theme; listeners.forEach(fn => fn()); resolve(view()); }, 900)),
    replay: () => Promise.resolve(view()),
    invalidate() {}
  };
};
const RESTORE_APPEARANCE = () => { const app = getApp(); if (globalThis.__origAppearance) app.appearanceController = globalThis.__origAppearance; };
// 用官方 API 换原生导航/Tab 配色（与 services/appearance.js 的 applyNative 相同调用与取值）。
const APPLY_NATIVE = (payload) => {
  const tokens = payload.tokens;
  try { wx.setNavigationBarColor({ frontColor: '#000000', backgroundColor: tokens.page }); } catch (e) { console.log('nav fail', e.errMsg || e); }
  try { wx.setBackgroundColor({ backgroundColor: tokens.page, backgroundColorTop: tokens.page, backgroundColorBottom: tokens.page }); } catch (e) { console.log('bg fail', e.errMsg || e); }
  try { wx.setTabBarStyle({ color: tokens.secondary, selectedColor: tokens.primary, backgroundColor: tokens.surface, borderStyle: 'white' }); } catch (e) { console.log('tabstyle fail', e.errMsg || e); }
  for (const [index, name] of ['today', 'progress', 'mine'].entries()) {
    try { wx.setTabBarItem({ index, iconPath: 'assets/tabbar/' + name + '.png',
      selectedIconPath: payload.theme === 'paper' ? 'assets/tabbar/' + name + '-selected-paper.png' : 'assets/tabbar/' + name + '-selected.png' }); }
    catch (e) { console.log('tabitem fail', e.errMsg || e); }
  }
};

(async () => {
  const miniProgram = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9431' });
  const info = await miniProgram.systemInfo();
  const width = info.windowWidth || info.screenWidth;
  console.log(`connected window ${width}x${info.windowHeight} sdk ${info.SDKVersion}`);
  const shot = async (name) => {
    const file = path.join(OUT, `${name}-w${width}.png`);
    await miniProgram.screenshot({ path: file });
    console.log('shot', path.basename(file));
    return file;
  };
  const goto = async (route, wait = 1600) => {
    await miniProgram.reLaunch(route);
    await sleep(wait);
    return miniProgram.currentPage();
  };

  // ================= W 层：真实云会话（当前开发者账户，未写入任何习惯/记录） =================
  await miniProgram.evaluate(RESTORE_APPEARANCE);
  await miniProgram.evaluate(RESTORE_STORE);
  let page = await goto('/pages/today/index', 2600);
  await shot('A27-today-empty-mist-W-real');

  await miniProgram.navigateTo('/pages/edit/index?template=read');
  await sleep(1400);
  await shot('A11-edit-compact-mist-W-real');

  page = await goto('/pages/appearance/index');
  await shot('A27-appearance-closed-mist-W-real');

  page = await goto('/pages/mine/index');
  await shot('A27-mine-entry-hidden-mist-W-real');
  console.log('mine appearanceEnabled =', (await page.data()).appearanceEnabled);

  // ================= F 层：注入状态渲染（真实模板/事件/渲染管线） =================
  const pendingOne = stateWith({ habits: [['read', {}]] });
  const completedOne = stateWith({ habits: [['read', {}]], records: [{ type: 'complete', id: 'read', date: today }] });
  const simplified = stateWith({ habits: [['read', {}]], records: [{ type: 'simplify', id: 'read', date: today, target: 2 }] });
  const returnCase = stateWith({ habits: [['read', {}]], back: 4 });
  const twoHabits = stateWith({ habits: [['read', {}], ['walk', { title: '走路一会儿', target: 10, minimum: 3, time: '08:00' }]] });
  const walkDone = stateWith({ habits: [['read', {}], ['walk', { title: '走路一会儿', target: 10, minimum: 3, time: '08:00' }]],
    records: [{ type: 'complete', id: 'walk', date: today }] });
  const bothDone = stateWith({ habits: [['read', {}], ['walk', { title: '走路一会儿', target: 10, minimum: 3, time: '08:00' }]],
    records: [{ type: 'complete', id: 'walk', date: today }, { type: 'completeMinimum', id: 'read', date: today }] });
  const progressState = stateWith({ habits: [['read', {}]], back: 6,
    records: [1,2,3,4,5].map(offset => ({ type: 'complete', id: 'read', date: dates.shift(today, -offset) })) });

  // F1 单任务待做（mist）
  await miniProgram.evaluate(INJECT_STORE, { states: [pendingOne, completedOne] });
  page = await goto('/pages/today/index');
  await shot('A18-today-pending-mist-inject');
  let button = await page.$('.check-pill');
  await button.tap();
  await sleep(900);
  await shot('A18-today-completed-inplace-mist-inject');
  let data = await page.data();
  console.log('retained rows', data.pendingRows.filter(r => r.undo).length, 'done', data.done, '/', data.total);

  // F2 两条原位完成（mist）：读一会儿(无时间)与走路(08:00)保持各自位置
  await miniProgram.evaluate(INJECT_STORE, { states: [twoHabits, walkDone, bothDone] });
  page = await goto('/pages/today/index');
  let buttons = await page.$$('.check-pill');
  await buttons[0].tap(); await sleep(800);   // 完成第一项（走路 · 原目标）
  buttons = await page.$$('.soft-button');
  await buttons[0].tap(); await sleep(900);   // 第二项（读一会儿 · 忙时）
  await shot('A22-today-two-retained-mist-inject');
  data = await page.data();
  console.log('rows', JSON.stringify(data.pendingRows.map(r => [r.id, r.undo])), 'done', data.done, '/', data.total);

  // F3 今日已完成分组（mist）：注入既有完成记录后展开
  await miniProgram.evaluate(INJECT_STORE, { states: [completedOne] });
  page = await goto('/pages/today/index');
  const disclosure = await page.$('.disclosure');
  await disclosure.tap(); await sleep(600);
  await shot('A22-completed-group-mist-inject');

  // F4 今日目标已调小（mist）：按今天 2 分钟记下 + 恢复今天原目标
  await miniProgram.evaluate(INJECT_STORE, { states: [simplified] });
  page = await goto('/pages/today/index');
  await shot('A20-today-simplified-mist-inject');

  // F5 回归提示（mist）：错过 2 个应做日，任务行紧邻一句提示
  await miniProgram.evaluate(INJECT_STORE, { states: [returnCase] });
  page = await goto('/pages/today/index');
  await shot('A44-today-return-line-mist-inject');

  // F6 添加习惯选择区（含助手入口，A43）
  await miniProgram.evaluate(INJECT_STORE, { states: [twoHabits] });
  page = await goto('/pages/today/index');
  const add = await page.$('.add-button');
  await add.tap(); await sleep(600);
  await shot('A43-today-chooser-mist-inject');

  // F7 进度（mist）
  await miniProgram.evaluate(INJECT_STORE, { states: [progressState] });
  page = await goto('/pages/progress/index');
  await shot('A46-progress-seven-days-mist-inject');

  // ================= F 层：暖纸白（页面作用域与原生配色都切到 paper） =================
  await miniProgram.evaluate(INJECT_APPEARANCE, { theme: 'paper' });
  await miniProgram.evaluate(APPLY_NATIVE, { theme: 'paper', tokens: THEMES.paper });

  await miniProgram.evaluate(INJECT_STORE, { states: [pendingOne, completedOne] });
  page = await goto('/pages/today/index');
  await shot('A28-today-pending-paper-inject');
  button = await page.$('.check-pill');
  await button.tap(); await sleep(900);
  await shot('A28-today-completed-inplace-paper-inject');

  await miniProgram.evaluate(INJECT_STORE, { states: [simplified] });
  page = await goto('/pages/today/index');
  await shot('A28-today-simplified-paper-inject');

  await miniProgram.reLaunch('/pages/edit/index?template=read');
  await sleep(1500);
  await shot('A28-edit-compact-paper-inject');

  await miniProgram.evaluate(INJECT_STORE, { states: [progressState] });
  page = await goto('/pages/progress/index');
  await shot('A46-progress-seven-days-paper-inject');

  page = await goto('/pages/mine/index');
  await shot('A28-mine-theme-entry-paper-inject');
  console.log('mine(paper) appearanceLabel =', (await page.data()).appearanceLabel);

  // F 主题页：使用中/预览中/保存（注入控制器，不写云端）
  page = await goto('/pages/appearance/index');
  await shot('A28-appearance-using-paper-inject');
  const cards = await page.$$('.theme-card');
  await cards[0].tap(); await sleep(500);
  await miniProgram.pageScrollTo(420);
  await sleep(400);
  await shot('A28-appearance-preview-mist-paper-inject');
  data = await page.data();
  console.log('appearance preview', data.preview, data.primaryLabel, data.savedTheme);
  const primary = await page.$('.primary');
  await primary.tap(); await sleep(1400);
  await shot('A28-appearance-after-save-paper-inject');
  data = await page.data();
  console.log('appearance after save', data.savedTheme, data.primaryLabel);

  // 收尾：恢复正常 store / appearance，原生化回到 mist，今日页复原
  await miniProgram.evaluate(RESTORE_APPEARANCE);
  await miniProgram.evaluate(RESTORE_STORE);
  await miniProgram.evaluate(APPLY_NATIVE, { theme: 'mist', tokens: THEMES.mist });
  await goto('/pages/today/index', 1200);
  console.log('done');
  process.exit(0);
})().catch(err => { console.error('FAIL', err && err.message || err, err && err.stack || ''); process.exit(1); });
