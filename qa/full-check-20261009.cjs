// 历史全量审查运行器，主流程对应助手移除前的 40 张截图；仅 inject/restore/state 供当前脚本复用。
// 当前首屏与助手移除流程分别见 centered-entry-20261009、remove-small-goal-assistant-20261009。
// 受控微信工具验收：全部账户与写入回执只在内存，结束恢复原服务。
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const automator = require(path.join(process.env.TEMP, 'mp-automator/node_modules/miniprogram-automator'));
const domain = require('../miniprogram/core/habits'), dates = require('../miniprogram/core/date');
const { THEMES } = require('../miniprogram/config/theme-tokens');
const out = path.resolve(__dirname, '../docs/audits/2026-10-09-full-review');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const day = dates.today();
let state = domain.emptyState();
for (const [id, title, offset, target, minimum] of [
  ['fixture-read', '读一会儿', -10, 5, 2], ['fixture-study', '复习一小段', -4, 10, 3],
  ['fixture-tidy', '整理桌面', 0, 3, 1], ['fixture-future', '明天读一会儿', 1, 5, 2]
]) state = domain.reduce(state, { type: 'create', id, startDate: dates.shift(day, offset),
  plan: { title, target, minimum, unit: '分钟', weekdays: [1,2,3,4,5,6,7], time: '' } }, offset > 0 ? day : dates.shift(day, offset));
for (let i = 6; i >= 1; i--) state = domain.reduce(state,
  { type: i % 2 ? 'completeMinimum' : 'complete', id: 'fixture-read', date: dates.shift(day, -i) }, dates.shift(day, -i));

function inject(payload) {
  const app = getApp();
  if (!globalThis.__fullReviewOriginal) {
    const keys = ['store','cloudSession','planAssistant','appearanceController','featuresClient','dataReady','firstHabitGuide','formDrafts'];
    globalThis.__fullReviewOriginal = {};
    keys.forEach(key => { globalThis.__fullReviewOriginal[key] = app[key]; });
  }
  const copy = value => JSON.parse(JSON.stringify(value));
  const s = { configured: true, ready: true, accountId: 'fixture-review', epoch: 'fixture-epoch', pending: 0, phase: 'ready' };
  const f = { state: copy(payload.state), mode: 'ready', commands: [], next: null, delay: 0 };
  globalThis.__fullReviewFixture = f;
  app.firstHabitGuide = null;
  app.formDrafts = undefined;
  app.dataReady = Promise.resolve();
  app.cloudSession = { status: () => ({ ...s, count: f.state.habits.length, ready: f.mode === 'ready', phase: f.mode === 'ready' ? 'ready' : f.mode }),
    subscribe: () => () => {}, start: async () => { f.mode = 'ready'; } };
  app.store = {
    contextKey: () => s.accountId + ':' + s.epoch,
    info: () => ({ ...app.cloudSession.status(), source: 'cloud', syncText: f.mode === 'ready' ? '云端数据已确认' : '连接网络后重新读取', syncAttention: f.mode !== 'ready' }),
    read: () => { if (f.mode !== 'ready') { const e = Error('受控网络状态'); e.code = f.mode === 'loading' ? 'DATA_LOADING' : 'DATA_UNAVAILABLE'; throw e; } return copy(f.state); },
    stale: () => f.mode === 'offline' ? copy(f.state) : null,
    dispatch: command => {
      f.commands.push(copy(command));
      if (!f.next) throw Error('受控审查禁止未准备的写入');
      const next = f.next; f.next = null;
      return new Promise(resolve => setTimeout(() => { f.state = copy(next); resolve(copy(next)); }, f.delay));
    }
  };
  app.planAssistant = globalThis.__fullReviewOriginal.planAssistant;
  app.featuresClient = { status: () => ({ enabled: false, reminders: false, publicShares: false }), cachedPreferences: () => null,
    publicShare: async () => { throw Error('公开分享暂未开放'); } };
  app.appearanceController = { view: () => ({ theme: payload.theme, enabled: true, revision: 0, loadState: 'ready', pendingTheme: '', themeName: payload.theme === 'paper' ? '暖纸白' : '薄雾绿' }),
    subscribe: () => () => {}, current: () => payload.theme, ensureRead: async () => {}, save: () => { throw Error('审查期间禁止主题保存'); } };
  wx.setNavigationBarColor({ frontColor: '#000000', backgroundColor: payload.tokens.page });
  wx.setBackgroundColor({ backgroundColor: payload.tokens.page });
}
function restore() {
  const app = getApp(), original = globalThis.__fullReviewOriginal;
  if (original) Object.keys(original).forEach(key => { app[key] = original[key]; });
  delete globalThis.__fullReviewOriginal; delete globalThis.__fullReviewFixture;
}

if (require.main === module) (async () => {
  fs.mkdirSync(out, { recursive: true });
  const mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:' + (process.env.MP_AUTO_PORT || 9431) });
  const resumed = process.env.MP_FLOW_ONLY === '1';
  const evidence = resumed ? JSON.parse(fs.readFileSync(path.join(out, 'observations.json'), 'utf8'))
    : { date: '2026-10-09', level: 'F', screenshots: [], checks: {}, exceptions: [] };
  if (resumed) evidence.screenshots = evidence.screenshots.filter(step => step.step <= 21);
  mp.on('exception', event => evidence.exceptions.push(String(event.message || event).slice(0,200)));
  let number = resumed ? 21 : 0;
  const shot = async (p, name) => {
    assert.equal((await mp.currentPage()).path, p.path);
    const file = String(++number).padStart(2, '0') + '-' + name + '-F.png';
    await mp.screenshot({ path: path.join(out, file) });
    const data = await p.data();
    evidence.screenshots.push({ step: number, file, route: p.path, loading: !!data.loading, readOnly: !!data.dataReadOnly });
    console.log('CAPTURE ' + file);
  };
  const page = async route => { const p = await mp.reLaunch('/' + route); await wait(450); assert.ok(await p.$('.page')); return p; };
  const tap = async (p, selector) => { const el = await p.$(selector); assert.ok(el, selector); await el.tap(); await wait(350); };
  const routed = async expected => {
    for (let i = 0; i < 30; i++) {
      const current = await mp.currentPage();
      if (current.path === expected) { await wait(500); return current; }
      await wait(250);
    }
    throw Error('Route did not become ' + expected);
  };
  try {
    await mp.evaluate(restore);
    const info = await mp.systemInfo();
    evidence.system = { windowWidth: info.windowWidth, windowHeight: info.windowHeight, fontSizeSetting: info.fontSizeSetting, platform: info.platform, SDKVersion: info.SDKVersion };
    for (const theme of resumed ? [] : ['mist','paper']) {
      await mp.evaluate(inject, { state, theme, tokens: THEMES[theme] });
      for (const route of require('../miniprogram/app.json').pages) {
        const name = route.split('/')[1];
        if (theme === 'paper' && !['today','progress','mine','detail','edit','appearance','assistant'].includes(name)) continue;
        const query = name === 'detail' ? '?id=fixture-read' : name === 'edit' ? '?template=tidy' : '';
        const p = await page(route + query);
        assert.equal((await p.data()).loading, false, route);
        if (name === 'mine' || name === 'today') assert.equal((await p.data()).assistantEnabled, true);
        await shot(p, name + '-' + theme);
      }
    }
    await mp.evaluate(inject, { state: domain.emptyState(), theme: 'mist', tokens: THEMES.mist });
    let p = await page('pages/today/index'); await shot(p, 'first-empty');
    await tap(p, '[data-template="tidy"]'); p = await routed('pages/edit/index');
    await wait(400); assert.equal((await p.data()).target, '3'); assert.equal((await p.data()).minimum, '1');
    await shot(p, 'template-confirm');
    p = await page('pages/mine/index');
    const entries = await p.$$('button.setting-row'); let assistantEntry;
    for (const entry of entries) if ((await entry.text()).includes('小目标助手')) { assistantEntry = entry; break; }
    assert.ok(assistantEntry); await assistantEntry.tap(); p = await routed('pages/assistant/index');
    await wait(400); await shot(p, 'assistant-entry');
    await tap(p, '.rules-button'); assert.equal((await p.data()).preview.source, 'rule'); await wait(300); await shot(p, 'rule-preview');
    await tap(p, '#plan-preview button.primary'); p = await routed('pages/edit/index');
    await wait(400); assert.match((await p.data()).source, /本机规则/); assert.doesNotMatch((await p.data()).source, /AI/);
    await shot(p, 'rule-confirm');
    assert.deepEqual(await mp.evaluate(() => globalThis.__fullReviewFixture.commands), []);
    evidence.checks.previewAndAdoptionWriteCount = 0;
    await mp.evaluate(inject, { state, theme: 'mist', tokens: THEMES.mist });
    p = await page('pages/today/index');
    const done = domain.reduce(state, { type: 'completeMinimum', id: 'fixture-tidy', date: day }, day);
    await mp.evaluate(next => { globalThis.__fullReviewFixture.next = next; globalThis.__fullReviewFixture.delay = 10000; }, done);
    const button = await p.$('.soft-button[data-id="fixture-tidy"]');
    if (!button) throw Error('busy action selector unavailable');
    await button.tap(); await wait(300); assert.equal((await p.data()).writeBusy, true); await shot(p, 'recording');
    await wait(10000); assert.equal((await p.data()).completed.length, 1); await shot(p, 'record-confirmed');
    const undo = domain.reduce(done, { type: 'undo', id: 'fixture-tidy', date: day }, day);
    await mp.evaluate(next => { globalThis.__fullReviewFixture.next = next; globalThis.__fullReviewFixture.delay = 0; }, undo);
    await tap(p, '.feedback-undo'); await wait(250); assert.equal((await p.data()).completed.length, 0); await shot(p, 'undo-confirmed');
    evidence.checks.fixtureCommands = await mp.evaluate(() => globalThis.__fullReviewFixture.commands.map(c => c.type));
    await mp.evaluate(() => { globalThis.__fullReviewFixture.mode = 'offline'; }); await p.callMethod('refresh'); await wait(350);
    assert.equal((await p.data()).dataReadOnly, true); await shot(p, 'offline-readonly');
    await mp.evaluate(() => { globalThis.__fullReviewFixture.mode = 'unavailable'; }); await p.callMethod('refresh'); await wait(350);
    assert.equal((await p.data()).dataUnavailable, true); await shot(p, 'read-unavailable');
    await mp.evaluate(() => { globalThis.__fullReviewFixture.mode = 'loading'; }); await p.callMethod('refresh'); await wait(350);
    assert.equal((await p.data()).loading, true); await shot(p, 'loading');
    await mp.evaluate(() => { globalThis.__fullReviewFixture.mode = 'ready'; });
    p = await page('pages/progress/index'); await tap(p, '[data-days="28"]'); await shot(p, 'progress28');
    evidence.checks.calendar = await mp.evaluate(() => new Promise(resolve => wx.createSelectorQuery().select('.calendar').boundingClientRect().select('.calendar-scroll').boundingClientRect().select('.cell').boundingClientRect().exec(resolve)));
    p = await page('pages/detail/index?id=missing-fixture'); assert.equal((await p.data()).invalid, true); await shot(p, 'invalid-detail');
    evidence.checks.realWrites = 0; evidence.checks.modelRequests = 0;
  } finally {
    await mp.evaluate(restore);
    await mp.reLaunch('/pages/today/index');
    evidence.checks.fixturePresentAfterRestore = await mp.evaluate(() => !!globalThis.__fullReviewFixture || !!globalThis.__fullReviewOriginal);
    fs.writeFileSync(path.join(out, 'observations.json'), JSON.stringify(evidence, null, 2));
    await mp.disconnect();
  }
  console.log(JSON.stringify({ screenshots: evidence.screenshots.length, checks: evidence.checks, exceptions: evidence.exceptions }));
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
module.exports = { inject, restore, state };
