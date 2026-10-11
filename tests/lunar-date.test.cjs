'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { lunarDate } = require('../miniprogram/core/lunar-date');

test('农历：已知历史日期与2026年中国历日一致', () => {
  // 2025/2026 dates cross-checked with Hong Kong Observatory conversion tables:
  // https://www.hko.gov.hk/tc/gts/time/calendar/pdf/files/2026.pdf
  // https://www.hko.gov.hk/tc/gts/time/calendar/pdf/files/2025.pdf
  const cases = [
    ['1986-05-29', 1986, 4, 21, false, '四月', '廿一'],
    ['2026-02-17', 2026, 1, 1, false, '正月', '初一'],
    ['2026-06-19', 2026, 5, 5, false, '五月', '初五'],
    ['2026-09-25', 2026, 8, 15, false, '八月', '十五'],
    ['2026-10-11', 2026, 9, 2, false, '九月', '初二'],
    ['2024-02-29', 2024, 1, 20, false, '正月', '二十'],
    ['2025-07-25', 2025, 6, 1, true, '闰六月', '初一']
  ];
  for (const [date, lYear, lMonth, lDay, isLeap, monthCn, dayCn] of cases) {
    const actual = lunarDate(date);
    assert.deepEqual(
      { lYear: actual.lYear, lMonth: actual.lMonth, lDay: actual.lDay,
        isLeap: actual.isLeap, monthCn: actual.monthCn, dayCn: actual.dayCn },
      { lYear, lMonth, lDay, isLeap, monthCn, dayCn }, date);
    assert.equal(actual.fullLabel, '农历' + monthCn + dayCn, date);
  }
});

test('农历：传统节日白名单覆盖且格内以节日优先', () => {
  const cases = [
    ['2026-02-17', '春节'], ['2026-03-03', '元宵'],
    ['2026-06-19', '端午'], ['2026-08-19', '七夕'],
    ['2026-09-25', '中秋'], ['2026-10-18', '重阳'],
    ['2026-01-26', '腊八']
  ];
  for (const [date, festival] of cases) {
    const actual = lunarDate(date);
    assert.equal(actual.isLeap, false, date);
    assert.equal(actual.festival, festival, date);
    assert.equal(actual.shortLabel, festival, date);
  }
  assert.equal(lunarDate('2026-01-01').festival, '');
  assert.equal(lunarDate('2026-10-01').festival, '');
});

test('农历：除夕跟随次日春节，适配腊月二十九和三十', () => {
  for (const [date, lDay] of [['2026-02-16', 29], ['2024-02-09', 30]]) {
    const actual = lunarDate(date);
    assert.equal(actual.lMonth, 12);
    assert.equal(actual.lDay, lDay);
    assert.equal(actual.festival, '除夕');
    assert.equal(actual.shortLabel, '除夕');
  }
  assert.equal(lunarDate('2026-02-15').festival, '');
  assert.equal(lunarDate('2024-02-08').festival, '');
});

test('农历：闰月不重复节日，月首和相邻月份不会漂移', () => {
  assert.equal(lunarDate('2009-05-28').festival, '端午');
  const repeated = lunarDate('2009-06-27');
  assert.equal(repeated.isLeap, true);
  assert.equal(repeated.lMonth, 5);
  assert.equal(repeated.lDay, 5);
  assert.equal(repeated.festival, '');
  assert.equal(repeated.shortLabel, '初五');
  const before = lunarDate('2025-07-24');
  const first = lunarDate('2025-07-25');
  const last = lunarDate('2025-08-22');
  const after = lunarDate('2025-08-23');
  assert.deepEqual([before.monthCn, before.lDay, before.shortLabel], ['六月', 30, '三十']);
  assert.deepEqual([first.monthCn, first.lDay, first.shortLabel], ['闰六月', 1, '闰六月']);
  assert.deepEqual([last.monthCn, last.lDay, last.shortLabel], ['闰六月', 29, '廿九']);
  assert.deepEqual([after.monthCn, after.lDay, after.shortLabel], ['七月', 1, '七月']);
});

test('农历：有效区间两端可用，区间外不阻断公历', () => {
  const first = lunarDate('1900-01-31');
  assert.deepEqual([first.lYear, first.lMonth, first.lDay], [1900, 1, 1]);
  assert.equal(first.festival, '春节');
  const last = lunarDate('2100-12-31');
  assert.deepEqual([last.lYear, last.lMonth, last.lDay], [2100, 12, 1]);
  assert.equal(last.shortLabel, '腊月');
  for (const date of ['1900-01-30', '2101-01-01', '1800-01-01', '9999-12-31']) {
    assert.equal(lunarDate(date), null, date);
  }
});

test('农历：非法日期被拒绝，不能被Date自动修正到其他日期', () => {
  for (const date of [null, undefined, 20261011, '', '2026-2-17', '2026-02-29',
    '2026-02-30', '2026-13-01', '2026-10-11T00:00:00Z']) {
    assert.throws(() => lunarDate(date), /日期.*无效/);
  }
});

test('农历：转换不依赖主机时区或本地跳过的日历日期', () => {
  const cases = ['2011-12-30', '2026-02-17', '2026-10-11', '2025-07-25'];
  const modulePath = require.resolve('../miniprogram/core/lunar-date');
  const script = 'const {lunarDate}=require(' + JSON.stringify(modulePath) +
    ');process.stdout.write(JSON.stringify(' + JSON.stringify(cases) + '.map(lunarDate)));';
  const expected = cases.map(lunarDate);
  for (const timezone of ['UTC', 'Asia/Shanghai', 'Pacific/Honolulu', 'Pacific/Apia']) {
    const result = spawnSync(process.execPath, ['-e', script], {
      env: { ...process.env, TZ: timezone }, encoding: 'utf8'
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), expected, timezone);
  }
});
