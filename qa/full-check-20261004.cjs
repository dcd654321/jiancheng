// 全路由受控渲染检查。仅 F 内存数据，禁止写入、真实 AI、订阅消息和公开分享创建。
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const automator = require(path.join(process.env.TEMP, 'mp-automator/node_modules/miniprogram-automator'));
const { inject, restore } = require('./ai-ui-20261002/capture.cjs');
const domain = require('../miniprogram/core/habits'), dates = require('../miniprogram/core/date');
const { THEMES } = require('../miniprogram/config/theme-tokens');
const pages = require('../miniprogram/app.json').pages;
const out = path.resolve(__dirname, '../docs/audits/2026-10-04-full-check');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const day = dates.today();
let state = domain.emptyState();
for (const [id, title, start, target, minimum] of [
  ['fixture-read', '读一会儿', dates.shift(day, -10), 5, 2],
  ['fixture-study', '复习一小段', dates.shift(day, -4), 10, 3],
  ['fixture-tidy', '整理桌面', day, 5, 2],
  ['fixture-future', '明天读一会儿', dates.shift(day, 1), 10, 3]
]) state = domain.reduce(state, { type: 'create', id, startDate: start,
  plan: { title, target, minimum, unit: '分钟', weekdays: [1,2,3,4,5,6,7], time: '' } }, start > day ? day : start);
state = domain.reduce(state, { type: 'completeMinimum', id: 'fixture-read', date: day }, day);
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:' + (process.env.MP_AUTO_PORT || 9433) });
  const observations = { level: 'F', routes: [] };
  try {
    await mp.evaluate(restore);
    await mp.evaluate(() => { globalThis.__fullCheckFeatures = getApp().featuresClient; });
    for (const theme of ['mist', 'paper']) {
      await mp.evaluate(inject, { theme, tokens: THEMES[theme], state });
      await mp.evaluate(() => {
        const app = getApp();
        const status = app.cloudSession.status;
        app.cloudSession.status = () => ({ ...status(), count: app.store.read().habits.length });
        app.featuresClient = { status: () => ({ enabled: false, reminders: false, publicShares: false }),
          cachedPreferences: () => null, publicShare: async () => { throw Error('公开分享暂未开放'); } };
      });
      for (const route of pages) {
        const name = route.split('/')[1];
        if (theme === 'paper' && !['today','progress','mine','detail','edit','appearance','assistant'].includes(name)) continue;
        const query = name === 'detail' ? '?id=fixture-read' : name === 'share-view' ? '?id=invalid-fixture' : name === 'edit' ? '?template=read' : '';
        const p = await mp.reLaunch('/' + route + query);
        await wait(1200);
        assert.equal((await mp.currentPage()).path, route);
        assert.ok(await p.$('.page'));
        const d = await p.data();
        assert.equal(d.loading, false, route + ': still loading');
        await mp.screenshot({ path: path.join(out, name + '-' + theme + '-F.png') });
        observations.routes.push({ route, theme, loading: !!d.loading, dataReady: d.dataReady,
          errorVisible: !!d.error, guardedDisabledFeature: ['share-create','share-list','share-view','reminder'].includes(name) });
        console.log('PASS render ' + name + ' ' + theme);
      }
    }
    // 当前运行包的模板展开后，非法详情链接有明确出口。
    const invalid = await mp.reLaunch('/pages/detail/index?id=unknown-fixture');
    await wait(700); assert.equal((await invalid.data()).invalid, true);
    observations.invalidDetail = true;
    fs.writeFileSync(path.join(out, 'routes.json'), JSON.stringify(observations, null, 2));
  } finally {
    await mp.evaluate(() => { getApp().featuresClient = globalThis.__fullCheckFeatures; delete globalThis.__fullCheckFeatures; });
    await mp.evaluate(restore);
    await mp.reLaunch('/pages/today/index'); await wait(700);
    console.log(JSON.stringify(await mp.evaluate(() => ({ fixturePresent: !!globalThis.__aiAuditOriginal || '__fullCheckFeatures' in globalThis }))));
    await mp.disconnect();
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
