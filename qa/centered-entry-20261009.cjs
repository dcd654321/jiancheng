// 当前首屏：只用内存夹具渲染、点击新增入口，不提交创建或写入云账户。
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const automator = require(path.join(process.env.TEMP, 'mp-automator/node_modules/miniprogram-automator'));
const { inject, restore, state } = require('./full-check-20261009.cjs');
const domain = require('../miniprogram/core/habits');
const dates = require('../miniprogram/core/date');
const { THEMES } = require('../miniprogram/config/theme-tokens');
const out = path.resolve(__dirname, '../docs/audits/2026-10-09-centered-entry');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9431' });
  const evidence = { level: 'F', realWrites: 0, screenshots: [], checks: {}, exceptions: [] };
  mp.on('exception', event => evidence.exceptions.push(String(event.message || event).slice(0, 200)));
  async function show(next, theme = 'mist') {
    await mp.evaluate(inject, { state: next, theme, tokens: THEMES[theme] });
    await mp.reLaunch('/pages/progress/index');
    const p = await mp.reLaunch('/pages/today/index');
    await wait(500);
    return p;
  }
  async function shot(name) {
    await wait(500);
    await mp.screenshot({ path: path.join(out, name + '.png') });
    evidence.screenshots.push(name + '.png');
    console.log(name);
  }
  async function routed(expected) {
    for (let attempt = 0; attempt < 20; attempt++) {
      const page = await mp.currentPage();
      if (page.path === expected) { await wait(700); return page; }
      await wait(250);
    }
    const page = await mp.currentPage();
    throw Error('Route did not become ' + expected + '; current=' + page.path + '; error=' + (await page.data()).error);
  }
  try {
    await mp.evaluate(restore);
    let p = await show(domain.emptyState());
    assert.equal((await p.data()).total, 0);
    assert.ok(await p.$('.empty-create'));
    assert.equal(await (await p.$('.empty-create')).text(), '添加习惯');
    assert.equal(await p.$('.tpl-grid'), null);
    await shot('01-empty');
    evidence.checks.rects = await mp.evaluate(() => new Promise(resolve => wx.createSelectorQuery()
      .select('.today-page').boundingClientRect()
      .select('.today-empty').boundingClientRect()
      .select('.empty-create').boundingClientRect().exec(resolve)));
    const [, area, button] = evidence.checks.rects;
    assert.ok(area.height > 200, '空态占满主要内容区域');
    assert.ok(Math.abs((area.left + area.width / 2) - (button.left + button.width / 2)) < 2, '水平居中');
    assert.ok(Math.abs((area.top + area.height / 2) - (button.top + button.height / 2)) < 2, '垂直居中');
    await (await p.$('.empty-create')).tap();
    p = await routed('pages/edit/index');
    assert.equal((await p.data()).title, '');
    assert.ok(await p.$('#minimum'), '自定义创建默认显示忙时目标');
    assert.equal((await p.data()).minimum, '');
    assert.deepEqual(await mp.evaluate(() => globalThis.__fullReviewFixture.commands), []);
    await shot('02-new-form');
    await p.callMethod('onInput', { currentTarget: { dataset: { field: 'minimum' } }, detail: { value: '2' } });
    assert.equal((await p.data()).minimum, '2');
    await p.callMethod('onRemoveMinimum');
    assert.equal((await p.data()).minimum, '');
    assert.ok(await p.$('#minimum'), '清空后输入框仍保留');
    evidence.checks.busyGoalVisibleByDefaultAndAfterClear = true;
    evidence.checks.addOpensCustomFormWithoutWrites = true;

    const day = dates.today();
    const weekday = new Date(day + 'T12:00:00').getDay() || 7;
    const rest = domain.reduce(domain.emptyState(), { type: 'create', id: 'fixture-rest', startDate: day,
      plan: { title: '明天的小事', target: 3, minimum: 1, unit: '分钟', weekdays: [weekday % 7 + 1], time: '' } }, day);
    p = await show(rest);
    assert.equal((await p.data()).hasHabits, true);
    assert.equal((await p.data()).total, 0);
    assert.ok(await p.$('.empty-create'));
    await shot('03-no-tasks');
    evidence.checks.restDayShowsAdd = true;

    p = await show(state);
    assert.ok((await p.data()).pending.length > 0);
    assert.equal(await p.$('.empty-create'), null);
    await shot('04-pending');
    let done = state;
    for (const task of domain.tasksOn(state, day)) done = domain.reduce(done, { type: 'complete', id: task.id, date: day }, day);
    p = await show(done);
    assert.equal((await p.data()).pending.length, 0);
    assert.ok((await p.data()).completed.length > 0);
    assert.equal(await p.$('.empty-create'), null);
    await shot('05-all-completed');
    evidence.checks.existingTasksRetained = true;

    await mp.evaluate(() => { globalThis.__fullReviewFixture.mode = 'loading'; });
    await p.callMethod('refresh');
    assert.equal((await p.data()).loading, true);
    assert.equal(await p.$('.empty-create'), null);
    await shot('06-loading');
    await mp.evaluate(() => { globalThis.__fullReviewFixture.mode = 'unavailable'; });
    await p.callMethod('refresh');
    assert.equal((await p.data()).dataUnavailable, true);
    await shot('07-error');
    p = await show(domain.emptyState(), 'paper');
    assert.ok(await p.$('.empty-create'));
    await shot('08-paper');
    evidence.checks.fixtureCommands = await mp.evaluate(() => globalThis.__fullReviewFixture.commands);
  } finally {
    await mp.evaluate(restore);
    await mp.reLaunch('/pages/today/index');
    evidence.checks.fixturePresentAfterRestore = await mp.evaluate(() => !!globalThis.__fullReviewFixture || !!globalThis.__fullReviewOriginal);
    fs.writeFileSync(path.join(out, 'observations.json'), JSON.stringify(evidence, null, 2));
    await mp.disconnect();
  }
  console.log(JSON.stringify(evidence));
})().catch(error => { console.error(error.stack); process.exit(1); });
