/* 隔离微信原生验证：当前源码临时副本、纯领域合成样例、禁云/请求/本机写入/业务写入。 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'docs/implementation/2026-10-27-fusion-native/native');
// Use the stable user TEMP path: command sandboxes have per-invocation temporary paths.
const tempRoot = process.env.FUSION_TEMP_ROOT || path.join(os.tmpdir(), 'jiancheng-fusion-native-20261027');
const port = Number(process.env.FUSION_AUTO_PORT || 9451);
const day = '2026-10-27';
const domain = require(path.join(root, 'miniprogram/core/habits'));
const dates = require(path.join(root, 'miniprogram/core/date'));
const review = require(path.join(root, 'miniprogram/core/progress-review'));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const fixtureDefinitions = [
  ['stretch', '晨间拉伸', 8, 2, '07:30', ['standard', 'standard', '', 'standard', 'minimum', 'standard']],
  ['read', '读一会儿', 20, 2, '12:30', ['standard', 'minimum', '', 'standard', 'standard', 'standard']],
  ['walk', '走一会儿', 20, 5, '18:30', ['minimum', 'standard', '', 'standard', 'standard', '']],
  ['tidy', '睡前整理', 10, 2, '21:30', ['', 'standard', '', 'minimum', '', '']]
];
function makeState(longName = false) {
  let state = domain.emptyState();
  for (const [id, title, target, minimum, time, history] of fixtureDefinitions) {
    state = domain.reduce(state, { type: 'create', id, startDate: '2026-10-01', plan: {
      title: longName && id === 'read' ? '每天阅读并整理今天值得保留下来的学习内容'.slice(0, 20) : title,
      target, minimum, unit: '分钟', weekdays: [1, 2, 3, 4, 5, 6, 7], time
    } }, '2026-10-01');
    history.forEach((status, index) => {
      const date = dates.shift(day, index - 6);
      if (status) state = domain.reduce(state, { type: status === 'minimum' ? 'completeMinimum' : 'complete', id, date }, date);
    });
  }
  state = domain.reduce(state, { type: 'complete', id: 'stretch', date: day }, day);
  state = domain.reduce(state, { type: 'note', id: 'read', date: day, note: '把书放在桌边，午饭后读几页。' }, day);
  state = domain.reduce(state, { type: 'settings', hideQuote: true }, day);
  const stats = review.summarizeRange(state, { start: '2026-10-21', end: day, today: day });
  const cells = dates.range(day, 7).map(date => domain.tasksOn(state, date));
  assert.deepEqual(cells.map(tasks => tasks.filter(task => task.done).length), [3, 4, 0, 4, 3, 2, 1]);
  assert.equal(cells.flat().filter(task => task.status === 'standard').length, 13);
  assert.equal(cells.flat().filter(task => task.status === 'minimum').length, 4);
  assert.equal(stats.closed.done, 16);
  assert.equal(stats.closed.planned, 24);
  return state;
}

// This function is serialized into the temporary app. It has no external dependencies.
function installFixture(payload) {
  const app = this && this.__fusionApp ? this : getApp();
  const copy = value => JSON.parse(JSON.stringify(value));
  const guard = globalThis.__fusionGuard;
  const f = { state: copy(payload.state), theme: payload.theme, fontSizeSetting: payload.fontSizeSetting || 16 };
  globalThis.__fusionFixture = f;
  const status = { configured: true, ready: true, accountId: 'synthetic-fusion', epoch: 'synthetic-epoch', pending: 0, phase: 'ready' };
  const forbid = name => () => { guard.businessWrites++; throw Error('隔离原生截图禁止业务写入: ' + name); };
  app.firstHabitGuide = null;
  app.formDrafts = undefined;
  app.noteDrafts = undefined;
  app.dataReady = Promise.resolve();
  app.ensureAccountReady = () => app.dataReady;
  app.cloudSession = { status: () => ({ ...status, count: f.state.habits.length }),
    subscribe: () => () => {}, subscribeConfirmed: () => () => {}, start: async () => {},
    onForeground: async () => copy(f.state), refresh: async () => copy(f.state), retry: async () => copy(f.state) };
  app.store = { contextKey: () => status.accountId + ':' + status.epoch,
    info: () => ({ ...status, source: 'cloud', syncText: '云端数据已确认', syncAttention: false }),
    read: () => copy(f.state), stale: () => null, dispatch: forbid('dispatch'), clear: forbid('clear') };
  app.featuresClient = { status: () => ({ enabled: !!payload.displayCapabilities, reminders: !!payload.displayCapabilities, publicShares: !!payload.displayCapabilities }), cachedPreferences: () => null,
    preferences: async () => null, publicShare: forbid('publicShare') };
  app.supervisionClient = { status: () => ({ enabled: !!payload.displayCapabilities }), list: async () => ({ items: [] }) };
  app.mediaClient = { status: () => ({ enabled: false }) };
  app.appearanceController = { view: () => ({ theme: payload.theme, enabled: true, revision: 0, loadState: 'ready', pendingTheme: '',
      themeName: payload.theme === 'paper' ? '暖纸白' : '薄雾绿' }),
    subscribe: () => () => {}, current: () => payload.theme, ensureRead: async () => {}, save: forbid('theme save') };
  // Native palette is painted by the production ui.bindTheme/applyPageAppearance path.
}

function bootstrap(payload) {
  const app = this;
  app.__fusionApp = true;
  globalThis.__fusionMarker = 'jiancheng-fusion-native-20261027-9451';
  const g = globalThis.__fusionGuard = { cloudCalls: 0, networkCalls: 0, storageWrites: 0, businessWrites: 0, installed: {} };
  const block = (counter, name) => function () { g[counter]++; throw Error('隔离原生检查禁止 ' + name); };
  const replace = (obj, key, counter, scope) => {
    try { obj[key] = block(counter, scope + '.' + key); g.installed[scope + '.' + key] = typeof obj[key] === 'function'; }
    catch (_) { g.installed[scope + '.' + key] = false; }
  };
  if (wx.cloud) {
    const keys = new Set(['init','callFunction','uploadFile','downloadFile','getTempFileURL','deleteFile','database','Cloud','callContainer','connectContainer','getCloudbaseExtConfig','getOpenData','getVoIPSign','getWXContext','extend']);
    let o = wx.cloud;
    while (o && o !== Object.prototype) { Object.getOwnPropertyNames(o).forEach(key => { try { if (typeof wx.cloud[key] === 'function') keys.add(key); } catch (_) {} }); o = Object.getPrototypeOf(o); }
    keys.forEach(key => replace(wx.cloud, key, 'cloudCalls', 'wx.cloud'));
  }
  ['request','uploadFile','downloadFile','connectSocket','sendSocketMessage'].forEach(key => replace(wx, key, 'networkCalls', 'wx'));
  ['setStorage','setStorageSync','removeStorage','removeStorageSync','clearStorage','clearStorageSync','batchSetStorage','batchSetStorageSync'].forEach(key => replace(wx, key, 'storageWrites', 'wx'));
  const originalInfo = wx.getSystemInfoSync.bind(wx);
  wx.getSystemInfoSync = () => ({ ...originalInfo(), fontSizeSetting: globalThis.__fusionFixture ? globalThis.__fusionFixture.fontSizeSetting : 16 });
  installFixture.call(app, payload);
}

function payload(theme = 'mist', longName = false, fontSizeSetting = 16) {
  // Reload tokens on each process; preparation always copies the then-current source.
  return { state: makeState(longName), theme, tokens: require(path.join(root, 'miniprogram/config/theme-tokens')).THEMES[theme], fontSizeSetting };
}
function prepare() {
  fs.mkdirSync(tempRoot, { recursive: true });
  fs.cpSync(path.join(root, 'miniprogram'), path.join(tempRoot, 'miniprogram'), { recursive: true, force: true });
  const config = JSON.parse(fs.readFileSync(path.join(root, 'project.config.json'), 'utf8'));
  config.projectname = '渐成融合UI隔离原生验证';
  delete config.cloudfunctionRoot;
  fs.writeFileSync(path.join(tempRoot, 'project.config.json'), JSON.stringify(config, null, 2));
  const dateFile = path.join(tempRoot, 'miniprogram/core/date.js');
  fs.writeFileSync(dateFile, fs.readFileSync(dateFile, 'utf8').replace(/function today\(now = Date\.now\(\)\) \{[\s\S]*?\n\}/, "function today() { return '2026-10-27';\n}"));
  fs.writeFileSync(path.join(tempRoot, 'miniprogram/app.js'), 'const installFixture = ' + installFixture.toString() + ';\nconst bootstrap = ' + bootstrap.toString() + ';\nApp({onLaunch() { bootstrap.call(this, ' + JSON.stringify(payload()) + '); }});\n');
  fs.mkdirSync(out, { recursive: true });
  const manifest = { level: 'isolated-wechat-devtools-native', tempRoot, port, date: day,
    sourceDigest: crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'miniprogram/pages/today/index.wxml'))).digest('hex'),
    fixture: { dailyDone: [3,4,0,4,3,2,1], standard: 13, minimum: 4, closedDone: 16, closedPlanned: 24 },
    guards: 'wx.cloud all exposed functions; wx request/upload/download/socket; local storage writes; store dispatch/clear and theme save blocked',
    verificationBoundary: 'Synthetic memory account in native WeChat DevTools. No real cloud, no device, no user acceptance.' };
  fs.writeFileSync(path.join(out, 'environment-prepare.json'), JSON.stringify(manifest, null, 2));
  console.log(JSON.stringify({ prepared: tempRoot, port, fixture: manifest.fixture }));
}
function refresh() {
  const source = path.join(root,'miniprogram'), destination = path.join(tempRoot,'miniprogram');
  assert.ok(fs.existsSync(path.join(destination,'app.js')), 'Prepare the isolated project first');
  for (const entry of fs.readdirSync(source,{withFileTypes:true})) {
    if (entry.name === 'app.js') continue;
    if (entry.name === 'core') {
      for (const core of fs.readdirSync(path.join(source,'core'),{withFileTypes:true})) {
        if (core.name !== 'date.js') fs.cpSync(path.join(source,'core',core.name),path.join(destination,'core',core.name),{recursive:true,force:true});
      }
    } else fs.cpSync(path.join(source,entry.name),path.join(destination,entry.name),{recursive:true,force:true});
  }
  console.log('Refreshed isolated UI source; bootstrap, fixed date and project config preserved');
}
function automator() {
  const candidates = [process.env.FUSION_AUTOMATOR, path.join(os.tmpdir(), 'mp-automator/node_modules/miniprogram-automator'), path.join(root, 'node_modules/miniprogram-automator')].filter(Boolean);
  const found = candidates.find(candidate => fs.existsSync(path.join(candidate, 'package.json')));
  assert.ok(found, 'miniprogram-automator unavailable');
  return require(found);
}
async function connect() {
  const mp = await automator().connect({ wsEndpoint: 'ws://127.0.0.1:' + port });
  try {
    assert.equal(await mp.evaluate(() => globalThis.__fusionMarker), 'jiancheng-fusion-native-20261027-9451', 'Wrong isolated project');
    return mp;
  } catch (error) { mp.disconnect(); throw error; }
}
async function probe() {
  const mp = await connect();
  try {
    const info = await mp.systemInfo();
    const viewport = Object.fromEntries(['windowWidth','windowHeight','screenWidth','screenHeight','pixelRatio','fontSizeSetting','platform','SDKVersion','model','system'].map(key => [key,info[key]]));
    const result = { level: 'isolated-native-environment-probe', viewport,
      route: (await mp.currentPage()).path, guard: await mp.evaluate(() => globalThis.__fusionGuard) };
    fs.writeFileSync(path.join(out, 'environment-probe.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
  } finally { await mp.disconnect(); }
}
const selectorSets = {
  today: ['.page','.page-header','.heading','.subline','.today-summary','.summary-top','.summary-bottom','.timeline-head','.timeline','.schedule-row','.timeline-time','.rail','.slot','.timeline-title','.task-meta','.timeline-checkin','.timeline-busy','.timeline-note'],
  progress: ['.page','.heading','.subline','.segments','.segment','.range','.progress-copy','.progress-statement','.chart-title','.week-trend','.trend-day','.bar-stack','.trend-legend','.rate-row','.current-line'],
  edit: ['.page','.back-heading','.heading','.form-intro','#field-title','#field-target','#field-minimum','.form-field','.field-label','.input','.minimum-heading','.week-options','.day-option','.primary','.submit-bar','.disclosure'],
  detail: ['.page','.back-heading','.heading','.detail-name','.habit-name','.status-line','.detail-section','.detail-section-head','.target-lines','.target-line','.detail-checkin-actions','.primary','.secondary','.note-preview','.plan-list','.plan-item','.more-group'],
  mine: ['.page','.heading','.subline','.mine-intro','.group','.group-label','.menu-list','.setting-row','.setting-row:not(.quote-setting)','.quote-setting','.menu-icon','.mine-footer']
};
async function capture(args) {
  const [label = 'today-390-mist', names = 'today', theme = 'mist', font = '16', variant = 'normal'] = args;
  assert.match(label, /^[a-z0-9-]+$/);
  const evidence = { label, level: 'isolated-wechat-devtools-native', theme, simulatedFontSizeSetting: Number(font), variant, screenshots: [], measurements: [], exceptions: [] };
  const sourceFiles = ['app.wxss','app.json','styles/theme.wxss','config/theme-tokens.js','services/ui.js','services/appearance.js',...names.split(',').flatMap(name=>['js','wxml','wxss'].map(ext=>'pages/'+name+'/index.'+ext))];
  evidence.sourceFiles = [...new Set(sourceFiles)].map(file=>{
    const digest=base=>crypto.createHash('sha256').update(fs.readFileSync(path.join(base,'miniprogram',file))).digest('hex');
    const workspace=digest(root),isolated=digest(tempRoot);
    assert.equal(isolated,workspace,'Isolated source stale: '+file);
    return {file,sha256:isolated};
  });
  const mp = await connect();
  mp.on('exception', value => evidence.exceptions.push(String(value.message || value).slice(0, 500)));
  try {
    evidence.startContext = { route:(await mp.currentPage()).path, theme:await mp.evaluate(()=>getApp().appearanceController.view().theme) };
    await mp.evaluate(installFixture, payload(theme, variant.includes('long'), Number(font)));
    const info = await mp.systemInfo();
    evidence.viewport = Object.fromEntries(['windowWidth','windowHeight','screenWidth','screenHeight','pixelRatio','fontSizeSetting','platform','SDKVersion','model'].map(key => [key,info[key]]));
    const expectedWidth = label.match(/(?:^|-)(320|375|390|430)(?:-|$)/);
    if (expectedWidth) assert.equal(info.windowWidth, Number(expectedWidth[1]), 'Actual native viewport must match capture label');
    console.log('VIEWPORT ' + JSON.stringify(evidence.viewport));
    for (const name of names.split(',')) {
      evidence.current = {page:name,phase:'navigation'};
      assert.ok(selectorSets[name], 'Unsupported page ' + name);
      await mp.evaluate(installFixture, { ...payload(theme, variant.includes('long'), Number(font)), displayCapabilities: name === 'mine' });
      const route = 'pages/' + name + '/index' + (name === 'detail' || (name === 'edit' && variant === 'editing') ? '?id=read' : '');
      const page = await mp.reLaunch('/' + route);
      for (let i = 0; i < 30; i++) {
        await wait(200);
        const data = await page.data();
        if ((await mp.currentPage()).path === route.split('?')[0] && await page.$('.page') && data.loading === false && data.dataReady) break;
      }
      const data = await page.data();
      assert.equal(data.loading, false, name + ' loading');
      assert.equal(data.dataReady, true, name + ' dataReady');
      if (name === 'today') await page.setData({ showCompleted: true });
      if (name === 'edit' && variant !== 'editing') {
        await mp.evaluate(isLong => {
          const p = getCurrentPages().slice(-1)[0];
          const title = isLong ? '每天阅读并整理今天值得保留下来的学习内容'.slice(0,20) : '';
          p.setData({ title, titleCount: title.length, target: '20', minimum: '2', addingMinimum: true, minimumVisible: true });
          p._cleanInput = ['title','target','minimum','unit','time','weekdays','startOffset','addingMinimum'].reduce((a,key) => { a[key] = p.data[key]; return a; }, {});
          p.updateSchedule();
          p.setData({ draftDirty: false, draftRestored: false });
        }, variant.includes('long'));
      }
      if (name === 'progress' && ['month','calendar'].includes(variant)) {
        const tabs = await page.$$('.segment');
        await tabs[variant === 'month' ? 1 : 2].tap();
        await wait(300);
        assert.equal((await page.data()).activeTab,variant,'Native tab interaction');
        evidence.visualSetup = 'Native segment tap; production '+variant+' projection from synthetic domain state';
      }
      await mp.pageScrollTo(0);
      await wait(600);
      if (name === 'edit' && variant === 'keyboard') {
        await (await page.$('#title')).tap();
        await wait(300);
        evidence.focusState = await mp.evaluate(() => {
          const p = getCurrentPages().slice(-1)[0], s = wx.getSystemInfoSync();
          return { focusField:p.data.focusField, keyboardOpen:p.data.keyboardOpen, windowWidth:s.windowWidth,windowHeight:s.windowHeight };
        });
      }
      const file = label + '-' + name + '.png';
      await mp.screenshot({ path: path.join(out, file) });
      const measurements = [];
      for (const selector of (variant.endsWith('snapshot') ? ['.page','.heading'] : selectorSets[name])) {
        evidence.current = {page:name,phase:'measure',selector};
        const elements = await page.$$(selector);
        const rects = [];
        for (const element of elements.slice(0, 16)) {
          const [offset,size,fontSize,lineHeight,content] = await Promise.all([element.offset(),element.size(),element.style('font-size'),element.style('line-height'),element.text()]);
          rects.push({ ...offset,...size,fontSize,lineHeight,text:content.slice(0,140) });
        }
        measurements.push({ selector, rects });
      }
      const pageInfo = await mp.systemInfo();
      if (expectedWidth) assert.equal(pageInfo.windowWidth, Number(expectedWidth[1]), 'Native viewport changed during capture');
      evidence.screenshots.push({ file, route, viewport: Object.fromEntries(['windowWidth','windowHeight','screenWidth','screenHeight','statusBarHeight','fontSizeSetting'].map(key=>[key,pageInfo[key]])) });
      if (name === 'edit') evidence.visualSetup = variant === 'editing' ? 'Existing read plan loaded through production edit branch; no form-value override, no save' : 'TEMP-only new form initial data: blank title, target20, minimum2, enabled; production defaults unchanged';
      evidence.measurements.push({ page: name, document: await page.size(), elements: measurements });
      if (variant === 'scroll' || variant === 'editing' || (variant === 'keyboard' && name === 'edit')) {
        await mp.pageScrollTo(99999);
        await wait(250);
        const bottom = label + '-' + name + '-bottom.png';
        await mp.screenshot({ path: path.join(out,bottom) });
        const pageElement = await page.$('.page');
        evidence.screenshots.push({file:bottom,route,scrollTop:await page.scrollTop(),pageOffset:pageElement ? await pageElement.offset() : null,note:'Native page scroll to content end; DOM scrollTop may differ from simulator page scrolling'});
      }
      console.log('CAPTURE ' + file);
      delete evidence.current;
    }
    evidence.guard = await mp.evaluate(() => globalThis.__fusionGuard);
    ['cloudCalls','networkCalls','storageWrites','businessWrites'].forEach(key => assert.equal(evidence.guard[key], 0, key));
    assert.deepEqual(evidence.exceptions, []);
  } catch (error) {
    evidence.error = String(error.message || error);
    throw error;
  } finally {
    fs.writeFileSync(path.join(out, label + '.json'), JSON.stringify(evidence, null, 2));
    await mp.disconnect();
  }
  console.log(JSON.stringify({ label, viewport:evidence.viewport, captures:evidence.screenshots.length, guard: evidence.guard, exceptions:evidence.exceptions }));
}
if (require.main === module) {
  const [mode, ...args] = process.argv.slice(2);
  Promise.resolve(mode === 'prepare' ? prepare() : mode === 'refresh' ? refresh() : mode === 'probe' ? probe() : mode === 'capture' ? capture(args) : Promise.reject(Error('Use prepare|refresh|probe|capture')))
    .catch(error => { console.error(error.stack); process.exitCode = 1; });
}
module.exports = { makeState, prepare, installFixture, bootstrap, capture, tempRoot, out, port, connect };
