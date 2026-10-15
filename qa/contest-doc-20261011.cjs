// 参赛说明文档截图：当前源码 × 双主题 × 主要状态。
// 账户与写入全部使用进程内夹具，替换 store/cloudSession/appearanceController/featuresClient；
// 不写本机存储、不发真实云请求。结束后恢复原服务。自动化端口默认 9431。
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const automator = require(path.join(process.env.TEMP, 'mp-automator/node_modules/miniprogram-automator'));
const domain = require('../miniprogram/core/habits'), dates = require('../miniprogram/core/date');
const { THEMES } = require('../miniprogram/config/theme-tokens');
const out = path.resolve(__dirname, '../docs/contest/captures');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const day = dates.today();

// 一个有历史的合成账户：四个习惯、近 10 天交替双档记录、今天已完成一项。
let state = domain.emptyState();
const HABITS = [
  ['habit-read', '读一会儿', 30, 10, 12],
  ['habit-walk', '轻松走一会儿', 30, 10, 9],
  ['habit-study', '复习一小段', 30, 10, 6],
  ['habit-tidy', '整理桌面', 15, 5, 4]
];
for (const [id, title, target, minimum, since] of HABITS) state = domain.reduce(state, {
  type: 'create', id, startDate: dates.shift(day, -since),
  plan: { title, target, minimum, unit: '分钟', weekdays: [1, 2, 3, 4, 5, 6, 7], time: '' }
}, dates.shift(day, -since));
for (const [id, , , , since] of HABITS) {
  for (let back = since; back >= 1; back--) {
    if ((back + id.length) % 4 === 0) continue;
    const type = (back + id.length) % 3 === 0 ? 'completeMinimum' : 'complete';
    state = domain.reduce(state, { type, id, date: dates.shift(day, -back) }, dates.shift(day, -back));
  }
}
state = domain.reduce(state, { type: 'complete', id: 'habit-study', date: day }, day);
const history = state;

function inject(payload) {
  const app = getApp();
  if (!globalThis.__captureOriginal) {
    const keys = ['store', 'cloudSession', 'appearanceController', 'featuresClient', 'dataReady', 'firstHabitGuide', 'formDrafts'];
    globalThis.__captureOriginal = {};
    keys.forEach(key => { globalThis.__captureOriginal[key] = app[key]; });
  }
  const copy = value => JSON.parse(JSON.stringify(value));
  const s = { configured: true, ready: true, accountId: 'fixture-contest', epoch: 'fixture-epoch', pending: 0, phase: 'ready' };
  const f = { state: copy(payload.state), mode: payload.mode || 'ready', commands: [], next: null, delay: 0 };
  globalThis.__captureFixture = f;
  app.firstHabitGuide = null;
  app.formDrafts = undefined;
  app.dataReady = Promise.resolve();
  app.cloudSession = { status: () => ({ ...s, count: f.state.habits.length, ready: f.mode === 'ready', phase: f.mode === 'ready' ? 'ready' : f.mode }),
    subscribe: () => () => {}, subscribeConfirmed: () => () => {}, start: async () => { f.mode = 'ready'; },
    onForeground: async () => copy(f.state), refresh: async () => copy(f.state), retry: async () => copy(f.state) };
  app.store = {
    contextKey: () => s.accountId + ':' + s.epoch,
    info: () => ({ ...app.cloudSession.status(), source: 'cloud', syncText: f.mode === 'ready' ? '云端数据已确认' : '连接网络后重新读取', syncAttention: f.mode !== 'ready' }),
    read: () => { if (f.mode !== 'ready') { const e = Error('受控网络状态'); e.code = f.mode === 'loading' ? 'DATA_LOADING' : 'DATA_UNAVAILABLE'; throw e; } return copy(f.state); },
    stale: () => f.mode === 'offline' ? copy(f.state) : null,
    dispatch: command => {
      f.commands.push(copy(command));
      if (!f.next) throw Error('文档截图禁止未准备的写入');
      const next = f.next; f.next = null;
      return new Promise(resolve => setTimeout(() => { f.state = copy(next); resolve(copy(next)); }, f.delay));
    },
    clear: async () => { f.commands.push({ type: 'purge' }); f.state = copy(domain.emptyState()); return copy(f.state); }
  };
  app.featuresClient = { status: () => ({ enabled: false, reminders: false, publicShares: false }), cachedPreferences: () => null,
    publicShare: async () => { throw Error('公开分享暂未开放'); } };
  app.appearanceController = { view: () => ({ theme: payload.theme, enabled: true, revision: 0, loadState: 'ready', pendingTheme: '', themeName: payload.theme === 'paper' ? '暖纸白' : '薄雾绿' }),
    subscribe: () => () => {}, current: () => payload.theme, ensureRead: async () => {}, save: () => { throw Error('截图期间禁止主题保存'); } };
  wx.setNavigationBarColor({ frontColor: '#000000', backgroundColor: payload.tokens.page });
  wx.setBackgroundColor({ backgroundColor: payload.tokens.page });
}
function restore() {
  const app = getApp(), original = globalThis.__captureOriginal;
  if (original) Object.keys(original).forEach(key => { app[key] = original[key]; });
  delete globalThis.__captureOriginal; delete globalThis.__captureFixture;
}

const PAGES = require('../miniprogram/app.json').pages;
const PAPER_PAGES = ['today', 'progress', 'mine', 'detail', 'edit', 'appearance', 'data', 'manage'];

if (require.main === module) (async () => {
  fs.mkdirSync(out, { recursive: true });
  const mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:' + (process.env.MP_AUTO_PORT || 9431) });
  const problems = [];
  let number = 0;
  const shot = async (p, name) => {
    const file = String(++number).padStart(2, '0') + '-' + name + '.png';
    await mp.screenshot({ path: path.join(out, file) });
    console.log('CAPTURE ' + file + '  ' + p.path);
  };
  const page = async route => {
    const p = await mp.reLaunch('/' + route);
    await wait(500);
    assert.ok(await p.$('.page'), route + ' 缺少 .page');
    return p;
  };
  const tap = async (p, selector) => { const el = await p.$(selector); assert.ok(el, selector); await el.tap(); await wait(400); };

  try {
    await mp.evaluate(restore);
    for (const theme of ['mist', 'paper']) {
      await mp.evaluate(inject, { state: history, theme, tokens: THEMES[theme] });
      for (const route of PAGES) {
        const name = route.split('/')[1];
        if (theme === 'paper' && !PAPER_PAGES.includes(name)) continue;
        const query = name === 'detail' ? '?id=habit-read' : '';
        try {
          const p = await page(route + query);
          await shot(p, name + '-' + theme);
          if (theme === 'mist' && name === 'today') {
            await tap(p, '[data-template="read"]');
            const confirm = await mp.currentPage();
            if (confirm.path === 'pages/edit/index') { await wait(400); await shot(confirm, 'template-confirm-mist'); }
          }
        } catch (error) { problems.push(theme + '/' + name + ': ' + error.message); }
      }
    }
    // 首次进入：空账户，主要内容区居中「添加习惯」。
    for (const theme of ['mist', 'paper']) {
      await mp.evaluate(inject, { state: domain.emptyState(), theme, tokens: THEMES[theme] });
      const p = await page('pages/today/index');
      await shot(p, 'first-empty-' + theme);
    }
    // 读取失败：恢复入口，不伪造空账户。
    await mp.evaluate(inject, { state: history, mode: 'unavailable', theme: 'mist', tokens: THEMES.mist });
    await shot(await page('pages/today/index'), 'read-unavailable-mist');
  } finally {
    try { await mp.evaluate(restore); await mp.reLaunch('/pages/today/index'); } catch (_) {}
    console.log(JSON.stringify({ captures: number, problems }, null, 2));
    await mp.disconnect();
  }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });

module.exports = { inject, restore, history, state, day };
