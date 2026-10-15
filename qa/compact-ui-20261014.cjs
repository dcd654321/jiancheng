// 当前源码的原生样式检查：临时副本 + 内存账户，云请求/业务写入/本机存储写入被阻断。
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { inject, history, day } = require('./contest-doc-20261011.cjs');
const { THEMES } = require('../miniprogram/config/theme-tokens');
const domain = require('../miniprogram/core/habits');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'docs/audits/2026-10-14-compact-ui');
const tempRoot = path.join(process.env.TEMP, 'jiancheng-compact-ui-20261014');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const mode = process.argv[2];

function prepare() {
  fs.mkdirSync(tempRoot, { recursive: true });
  fs.cpSync(path.join(root, 'miniprogram'), path.join(tempRoot, 'miniprogram'), { recursive: true });
  const config = JSON.parse(fs.readFileSync(path.join(root, 'project.config.json'), 'utf8'));
  config.projectname = '渐成样式隔离检查';
  delete config.cloudfunctionRoot;
  fs.writeFileSync(path.join(tempRoot, 'project.config.json'), JSON.stringify(config, null, 2));
  const fixtureSource = inject.toString().replace('const app = getApp();', 'const app = this;');
  const bootstrap = `const inject = ${fixtureSource};
App({ onLaunch() {
  globalThis.__compactGuard = { cloudCalls: 0, storageWrites: 0 };
  const blockedCloud = () => { globalThis.__compactGuard.cloudCalls++; return Promise.reject(Error('隔离样式检查禁止云请求')); };
  if (wx.cloud) ['init','callFunction','uploadFile','downloadFile','getTempFileURL','deleteFile','database'].forEach(key => { wx.cloud[key] = blockedCloud; });
  ['setStorage','setStorageSync','removeStorage','removeStorageSync','clearStorage','clearStorageSync'].forEach(key => { wx[key] = () => { globalThis.__compactGuard.storageWrites++; throw Error('隔离样式检查禁止本机存储写入'); }; });
  inject.call(this, ${JSON.stringify({ state: history, theme: 'mist', tokens: THEMES.mist })});
  this.supervisionClient = { status: () => ({enabled:false}) };
  this.mediaClient = { status: () => ({enabled:false}) };
} });`;
  fs.writeFileSync(path.join(tempRoot, 'miniprogram/app.js'), bootstrap);
  console.log(tempRoot);
}

async function capture(label) {
  assert.ok(['before', 'after', 'states'].includes(label));
  fs.mkdirSync(out, { recursive: true });
  const automator = require(path.join(process.env.TEMP, 'mp-automator/node_modules/miniprogram-automator'));
  const mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9437' });
  const evidence = { label, level: 'isolated-native-fixture', screenshots: [], measurements: [], exceptions: [] };
  mp.on('exception', value => evidence.exceptions.push(String(value.message || value).slice(0, 200)));
  const shot = async (name, route, selectors = [], setup) => {
    const p = await mp.reLaunch('/' + route);
    for (let i = 0; i < 20; i++) {
      await wait(200);
      if ((await mp.currentPage()).path === route.split('?')[0] && await p.$('.page') && !(await p.data()).loading) break;
    }
    assert.equal((await mp.currentPage()).path, route.split('?')[0]);
    assert.ok(await p.$('.page'));
    assert.equal((await p.data()).loading, false, name);
    if (setup) await setup(p);
    await wait(350);
    const file = label + '-' + name + '.png';
    await mp.screenshot({ path: path.join(out, file) });
    const rects = [];
    for (const selector of selectors) {
      const element = await p.$(selector);
      rects.push(element ? { ...(await element.size()), fontSize: await element.style('font-size') } : null);
    }
    evidence.screenshots.push({ file, route });
    evidence.measurements.push({ name, selectors, rects });
    console.log('CAPTURE ' + file);
    return p;
  };
  try {
    const info = await mp.systemInfo();
    evidence.viewport = { windowWidth: info.windowWidth, windowHeight: info.windowHeight, fontSizeSetting: info.fontSizeSetting };
    for (const theme of ['mist', 'paper']) {
      await mp.evaluate(inject, { state: history, theme, tokens: THEMES[theme] });
      if (label === 'states') {
        await shot('calendar-' + theme, 'pages/progress/index', ['.month-cell', '.calendar-day', '.month-step'], async p => {
          await (await p.$('[data-tab="calendar"]')).tap();
        });
        await shot('progress-large-' + theme, 'pages/progress/index', ['.heading', '.metric', '.segment'], p => p.setData({ fontScale: 1.25 }));
        await shot('today-large-' + theme, 'pages/today/index', ['.task', '.check-pill'], p => p.setData({ largeFont: true }));
        await shot('detail-more-' + theme, 'pages/detail/index?id=habit-read', ['.action-header', '.setting-row'], async p => {
          await (await p.$('.more-header')).tap();
        });
        const long = domain.reduce(domain.emptyState(), { type:'create', id:'fixture-long', startDate:day,
          plan:{title:'每天阅读并整理今天值得保留下来的学习内容'.slice(0,20),target:30,minimum:10,unit:'分钟',weekdays:[1,2,3,4,5,6,7],time:''} }, day);
        await mp.evaluate(inject, { state:long, theme, tokens:THEMES[theme] });
        await shot('today-long-' + theme, 'pages/today/index', ['.task-title', '.check-pill']);
        continue;
      }
      await shot('today-' + theme, 'pages/today/index', ['.heading','.task','.task-title','.check-pill']);
      await shot('progress-' + theme, 'pages/progress/index', ['.heading','.metric','.trend-day','.segment']);
      await shot('mine-' + theme, 'pages/mine/index', ['.heading','.setting-row']);
      await shot('edit-' + theme, 'pages/edit/index', ['.heading','.input','.day-option','.primary']);
      await shot('detail-' + theme, 'pages/detail/index?id=habit-read', ['.heading','.task-title']);
      await shot('appearance-' + theme, 'pages/appearance/index', ['.theme-name','.theme-card','.primary']);
      if (label === 'after') {
        await shot('manage-' + theme, 'pages/manage/index', ['.heading','.task-title']);
        await shot('sync-' + theme, 'pages/sync/index', ['.heading','.status-title']);
        await shot('reminder-' + theme, 'pages/reminder/index', ['.heading']);
        await shot('supervision-' + theme, 'pages/supervision/index', ['.heading']);
      }
      await mp.evaluate(inject, { state: domain.emptyState(), theme, tokens: THEMES[theme] });
      await shot('empty-' + theme, 'pages/today/index', ['.today-empty','.empty-create']);
    }
    evidence.guard = await mp.evaluate(() => ({ ...globalThis.__compactGuard, businessWrites: globalThis.__captureFixture.commands.length }));
    assert.equal(evidence.guard.cloudCalls, 0);
    assert.equal(evidence.guard.storageWrites, 0);
    assert.equal(evidence.guard.businessWrites, 0);
    assert.deepEqual(evidence.exceptions, []);
  } finally {
    fs.writeFileSync(path.join(out, label + '.json'), JSON.stringify(evidence, null, 2));
    await mp.disconnect();
  }
  console.log(JSON.stringify({ screenshots: evidence.screenshots.length, viewport:evidence.viewport, guard: evidence.guard, exceptions:evidence.exceptions }));
}

if (mode === 'prepare') prepare();
else capture(mode).catch(error => { console.error(error.stack); process.exitCode = 1; });
