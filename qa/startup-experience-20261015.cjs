// 原生模拟器隔离验证：复制当前小程序，只替换副本 App。
// 复用真实 app-lifecycle / cloud-session / workspace-store 和页面，mock transport / 外观 / 监控。
// 夹具阻断真实云请求、网络请求、业务写入与本机存储读写；不代表真实云或真机启动耗时。
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const fixtureRoot = 'D:\\codex\\coding\\audit\\jiancheng-startup-fixture-20261015';
const out = path.join(root, 'docs/audits/2026-10-15-startup-experience');
const automatorPath = 'C:\\Users\\dcd\\AppData\\Local\\Temp\\mp-automator\\node_modules\\miniprogram-automator';
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function isolatedApp() {
  const { createAppLifecycle } = require('./services/app-lifecycle');
  const { createCloudSession } = require('./services/cloud-session');
  const { createWorkspaceStore } = require('./services/workspace-store');
  const domain = require('./core/habits');
  const dates = require('./core/date');
  const { THEMES } = require('./config/theme-tokens');
  const cloudConfig = require('./config/cloud');
  const guard = globalThis.__startupGuard = { cloudCalls: 0, networkCalls: 0, storageReads: 0, storageWrites: 0, businessWrites: 0, transportReads: 0 };
  const block = (counter, label) => () => { guard[counter]++; throw Error('隔离启动检查禁止' + label); };
  if (wx.cloud) {
    ['init', 'callFunction', 'uploadFile', 'downloadFile', 'getTempFileURL', 'deleteFile', 'database', 'Cloud'].forEach(key => { wx.cloud[key] = block('cloudCalls', '真实云调用'); });
  }
  ['request', 'uploadFile', 'downloadFile', 'connectSocket'].forEach(key => { wx[key] = block('networkCalls', '真实网络请求'); });
  ['getStorage', 'getStorageSync', 'getStorageInfo', 'getStorageInfoSync', 'batchGetStorageSync'].forEach(key => { wx[key] = block('storageReads', '本机存储读取'); });
  ['setStorage', 'setStorageSync', 'removeStorage', 'removeStorageSync', 'clearStorage', 'clearStorageSync', 'batchSetStorageSync'].forEach(key => { wx[key] = block('storageWrites', '本机存储写入'); });
  const day = dates.today();
  let state = domain.emptyState();
  for (const [id, title] of [['fixture-read', '读一会儿'], ['fixture-walk', '轻松走一会儿']]) {
    state = domain.reduce(state, { type: 'create', id, startDate: day,
      plan: { title, target: 30, minimum: 10, unit: '分钟', weekdays: [1, 2, 3, 4, 5, 6, 7], time: '' } }, day);
  }
  const snapshot = { ok: true, accountId: 'a'.repeat(64), epoch: 'startup-fixture', revision: 0, state, serverDate: day };
  App({
    onLaunch() {
      this.__fixture = { theme: 'mist', mode: 'hang', startedAt: 0, timings: [] };
      this.__reset = (theme, mode = 'hang') => {
        if (this.__lifecycle) this.__lifecycle.onHide(this);
        this.__fixture.theme = theme; this.__fixture.mode = mode; this.__fixture.startedAt = Date.now(); this.__fixture.timings = [];
        const transport = event => {
          if (event.action !== 'pull') { guard.businessWrites++; throw Error('隔离启动检查禁止业务写入'); }
          guard.transportReads++;
          return this.__fixture.mode === 'ready' ? Promise.resolve(JSON.parse(JSON.stringify(snapshot))) : new Promise(() => {});
        };
        const appearance = {
          view: () => ({ theme: this.__fixture.theme, enabled: true, revision: 0, loadState: 'ready', pendingTheme: '', themeName: this.__fixture.theme === 'paper' ? '暖纸白' : '薄雾绿' }),
          current: () => this.__fixture.theme, subscribe: () => () => {}, ensureRead: async () => {}, dispose() {}
        };
        this.featuresClient = { status: () => ({ enabled: false, reminders: false }), cachedPreferences: () => null };
        this.supervisionClient = this.mediaClient = { status: () => ({ enabled: false }) };
        this.__lifecycle = createAppLifecycle({ wxApi: {}, cloudConfig,
          createCloudSession: (wxApi, config, unused, options) => createCloudSession(wxApi, config, () => transport, options),
          createWorkspaceStore, createQuoteSession: () => ({}),
          createOperationsMonitor: () => ({ onShow() {}, onReady() {}, onHide() {}, dispose() {} }),
          createAppearanceClient: () => ({}), createAppearanceController: () => appearance,
          onStartupTiming: sample => this.__fixture.timings.push(sample)
        });
        const tokens = THEMES[theme];
        wx.setNavigationBarColor({ frontColor: '#000000', backgroundColor: tokens.page });
        wx.setBackgroundColor({ backgroundColor: tokens.page });
        wx.setTabBarStyle({ color: tokens.secondary, selectedColor: tokens.primary, backgroundColor: tokens.surface, borderStyle: 'white' });
        this.__lifecycle.onLaunch(this); this.__lifecycle.onShow(this);
        return true;
      };
      this.__reset('mist');
    },
    onHide() { if (this.__lifecycle) this.__lifecycle.onHide(this); },
    onShow() { if (this.__lifecycle && !this._foreground) this.__lifecycle.onShow(this); }
  });
}

function prepare() {
  fs.mkdirSync(fixtureRoot, { recursive: true });
  fs.cpSync(path.join(root, 'miniprogram'), path.join(fixtureRoot, 'miniprogram'), { recursive: true });
  const config = JSON.parse(fs.readFileSync(path.join(root, 'project.config.json'), 'utf8'));
  config.projectname = '渐成启动隔离检查'; delete config.cloudfunctionRoot;
  fs.writeFileSync(path.join(fixtureRoot, 'project.config.json'), JSON.stringify(config, null, 2));
  fs.writeFileSync(path.join(fixtureRoot, 'miniprogram/app.js'), '(' + isolatedApp.toString() + ')();\n');
  fs.mkdirSync(out, { recursive: true });
  console.log(JSON.stringify({ fixtureRoot, out }));
}

async function capture() {
  fs.mkdirSync(out, { recursive: true });
  const evidence = { level: 'isolated-native-fixture', source: root, fixtureRoot, endpoint: 'ws://127.0.0.1:9438', screenshots: [], states: [], exceptions: [], errors: [] };
  let mp;
  const until = async (condition, timeout = 10000) => {
    const start = Date.now();
    while (Date.now() - start < timeout) { if (await condition()) return; await wait(100); }
    throw Error('等待原生页面状态超时');
  };
  try {
    const automator = require(automatorPath);
    mp = await automator.connect({ wsEndpoint: evidence.endpoint });
    mp.on('exception', value => evidence.exceptions.push(String(value.message || value).slice(0, 400)));
    const info = await mp.systemInfo(); evidence.viewport = { windowWidth: info.windowWidth, windowHeight: info.windowHeight, fontSizeSetting: info.fontSizeSetting, SDKVersion: info.SDKVersion };
    evidence.initialStack = await mp.evaluate(() => getCurrentPages().map(page => page.route));
    const shot = async (page, theme, stateName) => {
      // Capture before slower element inspection so the first skeleton image
      // still belongs to its initial read window.
      const file = theme + '-' + stateName + '.png';
      const data = await page.data();
      await mp.screenshot({ path: path.join(out, file) });
      const stack = await mp.evaluate(() => getCurrentPages().map(item => item.route));
      assert.ok(stack.includes('pages/today/index'), '没有真实 Today 页面栈');
      assert.equal((await mp.currentPage()).path, 'pages/today/index'); assert.ok(await page.$('.today-page'));
      const elements = {};
      await Promise.all(['.startup-skeleton', '.skeleton-card', '.loading-status', '.empty .primary', '.task', '.read-status'].map(async selector => {
        const el = await page.$(selector);
        if (!el) { elements[selector] = null; return; }
        const [size, text] = await Promise.all([el.size(), el.text()]);
        elements[selector] = { size, text };
      }));
      let skeletonBounds;
      if (data.loading) {
        const cards = await page.$$('.skeleton-card');
        skeletonBounds = await Promise.all(cards.map(async card => {
          const footer = await card.$('.skeleton-footer'); assert.ok(footer);
          const [size, offset, footerSize, footerOffset] = await Promise.all([card.size(), card.offset(), footer.size(), footer.offset()]);
          return { size, offset, footerSize, footerOffset };
        }));
        assert.equal(skeletonBounds.length, 2);
        for (const bounds of skeletonBounds) {
          assert.ok(Number(bounds.size.height) >= 110, '骨架卡高度不足：' + JSON.stringify(bounds));
          assert.ok(Number(bounds.footerOffset.top) >= Number(bounds.offset.top), '骨架footer在卡片上方');
          assert.ok(Number(bounds.footerOffset.top) + Number(bounds.footerSize.height) <= Number(bounds.offset.top) + Number(bounds.size.height), '骨架footer溢出卡片');
        }
      }
      const fixture = await mp.evaluate(() => ({ elapsedMs: Date.now() - getApp().__fixture.startedAt, session: getApp().cloudSession.status(), timings: getApp().__fixture.timings }));
      evidence.screenshots.push({ file, theme, state: stateName });
      evidence.states.push({ theme, state: stateName, stack, data: { loading: data.loading, dataReady: data.dataReady, dataUnavailable: data.dataUnavailable, startupLoadingText: data.startupLoadingText, startupUnavailableTitle: data.startupUnavailableTitle, readRefreshing: data.readRefreshing, total: data.total }, elements, skeletonBounds, ...fixture });
      console.log('CAPTURE ' + file);
    };
    for (const theme of ['mist', 'paper']) {
      await mp.evaluate(theme => getApp().__reset(theme), theme);
      // automator.reLaunch / switchTab each sleep for 3000 ms internally.
      // Native API + page polling preserves the real first loading frame.
      await mp.callWxMethod('reLaunch', { url: '/pages/today/index' });
      let page;
      await until(async () => { page = await mp.currentPage(); return page?.path === 'pages/today/index' && !!(await page.$('.startup-skeleton')); }, 6000);
      assert.equal((await page.data()).dataReady, false);
      await shot(page, theme, 'skeleton');
      await until(async () => (await page.data()).startupLoadingText === '连接有些慢，正在读取今日习惯', 5000);
      await shot(page, theme, 'slow');
      await until(async () => (await page.data()).dataUnavailable, 7000);
      assert.equal((await page.data()).startupUnavailableTitle, '暂时没能读取习惯');
      await shot(page, theme, 'timeout');
      await mp.evaluate(() => { getApp().__fixture.mode = 'ready'; });
      const retry = await page.$('.empty .primary'); assert.ok(retry); await retry.tap();
      await until(async () => (await page.data()).dataReady && (await page.data()).total === 2, 4000);
      assert.equal(await page.$('.startup-skeleton'), null);
      await shot(page, theme, 'retry-ready');
      await mp.callWxMethod('switchTab', { url: '/pages/progress/index' });
      await until(async () => (await mp.currentPage())?.path === 'pages/progress/index', 4000);
      await mp.callWxMethod('switchTab', { url: '/pages/today/index' });
      await until(async () => { page = await mp.currentPage(); return page?.path === 'pages/today/index' && (await page.data()).dataReady; }, 4000);
      await mp.evaluate(() => { const app = getApp(); app.__fixture.mode = 'hang'; void app.cloudSession.refresh().catch(() => {}); });
      await until(async () => (await page.data()).readRefreshing, 2000);
      assert.equal(await page.$('.startup-skeleton'), null);
      await shot(page, theme, 'warm-return');
    }
    evidence.guard = await mp.evaluate(() => ({ ...globalThis.__startupGuard }));
    for (const field of ['cloudCalls', 'networkCalls', 'storageReads', 'storageWrites', 'businessWrites']) assert.equal(evidence.guard[field], 0, field);
    assert.deepEqual(evidence.exceptions, []);
    evidence.result = 'passed';
  } catch (error) {
    evidence.result = 'failed'; evidence.errors.push(String(error.stack || error)); throw error;
  } finally {
    fs.writeFileSync(path.join(out, 'evidence.json'), JSON.stringify(evidence, null, 2));
    if (mp) await mp.disconnect();
  }
  console.log(JSON.stringify({ result: evidence.result, screenshots: evidence.screenshots.length, viewport: evidence.viewport, guard: evidence.guard, exceptions: evidence.exceptions }));
}

if (process.argv[2] === 'prepare') prepare();
else if (process.argv[2] === 'capture') capture().catch(error => { console.error(error.stack); process.exitCode = 1; });
else throw Error('Usage: node qa/startup-experience-20261015.cjs prepare|capture');
