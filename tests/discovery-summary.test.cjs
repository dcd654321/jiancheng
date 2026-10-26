'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { summarizeDiscovery } = require('../scripts/lib/discovery-summary.cjs');
const source = { visitId: 'visit_a', scene: 1053, route: 'pages/template/index', templateKey: 'read' };
function row(type, second, changes = {}) {
  return { appId: 'jiancheng', type, sourceUserId: 'actor_a', accountGeneration: 'epoch_a',
    occurredAt: `2026-10-18T01:00:0${second}Z`,
    payload: type.startsWith('discovery_') ? { ...source } : { searchSource: { ...source } }, ...changes };
}

test('汇总按访问去重，只有顺序完整的服务端事件计完整转化', () => {
  const events = [row('discovery_page_view', 0), row('discovery_template_selected', 1), row('habit_created', 2), row('checkin_completed', 3)];
  const result = summarizeDiscovery([...events, ...events].reverse());
  assert.deepEqual(result.totals, { visits: 1, enteredVisits: 0, viewedVisits: 1, selectedVisits: 1, createdVisits: 1, checkinVisits: 1, orderedConversions: 1 });
  assert.equal(result.byChannel.search.visits, 1);
  assert.equal(result.byTemplate.read.checkinVisits, 1);
  const wrongOrder = summarizeDiscovery([row('discovery_page_view', 3), row('discovery_template_selected', 2), row('habit_created', 1), row('checkin_completed', 0)]);
  assert.equal(wrongOrder.totals.orderedConversions, 0);
});

test('导出数据缺少环节时不推算流量或成功转化', () => {
  const result = summarizeDiscovery([row('habit_created', 2)]);
  assert.equal(result.totals.visits, 1);
  assert.equal(result.totals.viewedVisits, 0);
  assert.equal(result.totals.checkinVisits, 0);
  assert.equal(result.totals.orderedConversions, 0);
});

test('同访问先有旧习惯打卡，后续完整有序转化仍被识别', () => {
  const result = summarizeDiscovery([row('checkin_completed', 4), row('habit_created', 3),
    row('discovery_template_selected', 2), row('checkin_completed', 1), row('discovery_page_view', 0)]);
  assert.equal(result.totals.orderedConversions, 1);
  assert.equal(result.totals.checkinVisits, 1);
});

test('排除其他应用、爬虫、非法来源、无日期和未归因事件', () => {
  const result = summarizeDiscovery([
    row('discovery_page_view', 0, { appId: 'another_app' }),
    row('discovery_page_view', 0, { payload: { ...source, scene: 1129 } }),
    row('discovery_page_view', 0, { payload: { ...source, route: 'pages/detail/index' } }),
    row('discovery_page_view', 0, { payload: { ...source, templateKey: '__proto__' } }),
    row('discovery_page_view', 0, { occurredAt: null }), row('habit_created', 0, { payload: {} }),
    row('discovery_page_view', 0, { sourceUserId: '' })
  ]);
  assert.equal(result.ignoredRows, 7); assert.equal(result.totals.visits, 0);
});

test('相同访问标识按账户和epoch隔离，输出不包含用户或原始输入', () => {
  const events = [row('discovery_page_view', 0), row('discovery_page_view', 0, { sourceUserId: 'actor_b' }),
    row('discovery_page_view', 0, { accountGeneration: 'epoch_b', payload: { ...source, rawQuery: 'private-sentinel' } })];
  const result = summarizeDiscovery(events);
  assert.equal(result.totals.visits, 3);
  assert.doesNotMatch(JSON.stringify(result), /actor_a|actor_b|epoch_a|private-sentinel|visit_a/);
});

test('概览访问后选择模板按最后合法模板汇总，支持CloudBase日期字段', () => {
  const result = summarizeDiscovery([
    row('discovery_page_view', 0, { payload: { visitId: 'visit_a', scene: 1053, route: 'pages/discover/index' } }),
    row('discovery_template_selected', 1, { occurredAt: { $date: '2026-10-18T01:00:01Z' } })
  ]);
  assert.equal(result.byTemplate.read.visits, 1); assert.equal(result.totals.visits, 1);
});

test('名称搜索进入固定今日首页可统计进入和转化，不虚构公开浏览', () => {
  const home = { visitId: 'home_a', scene: 1005, route: 'pages/today/index' };
  const result = summarizeDiscovery([row('discovery_entry', 0, { payload: home }),
    row('habit_created', 1, { payload: { searchSource: home } })]);
  assert.equal(result.byChannel.search.enteredVisits, 1);
  assert.equal(result.totals.createdVisits, 1); assert.equal(result.totals.viewedVisits, 0);
});

test('回访按北京时间和账户epoch计算，未到观察日的样本不当作流失', () => {
  const events = [row('discovery_entry', 0), row('app_start', 0, { occurredAt: '2026-10-18T16:10:00Z', payload: {} }),
    row('app_start', 0, { occurredAt: '2026-10-25T01:00:00Z', payload: {} }),
    row('discovery_entry', 0, { sourceUserId: 'new_actor', occurredAt: '2026-10-25T01:00:00Z' }),
    row('app_start', 0, { sourceUserId: 'new_actor', accountGeneration: 'different_epoch', occurredAt: '2026-10-26T01:00:00Z', payload: {} })];
  const result = summarizeDiscovery(events);
  assert.equal(result.retention.cohortAccounts, 2);
  assert.deepEqual(result.retention.nextDay, { eligibleAccounts: 2, returnedAccounts: 1, rate: 0.5 });
  assert.deepEqual(result.retention.day7, { eligibleAccounts: 1, returnedAccounts: 1, rate: 1 });
  const immature = summarizeDiscovery([row('discovery_entry', 0)]);
  assert.deepEqual(immature.retention.day7, { eligibleAccounts: 0, returnedAccounts: 0, rate: null });
  const crawler = summarizeDiscovery([row('discovery_entry', 0), row('discovery_entry', 0, {
    occurredAt: '2026-10-25T01:00:00Z', payload: { ...source, scene: 1129 }
  })]);
  assert.equal(crawler.retention.day7.eligibleAccounts, 0);
});
