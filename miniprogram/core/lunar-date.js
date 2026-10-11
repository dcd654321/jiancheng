'use strict';

/*
 * Derived from solarlunar 3.1.0, commit df2cbf9851ac631fdeeb9ba08325ef8fed97a43d.
 * https://github.com/yize/solarlunar/blob/df2cbf9851ac631fdeeb9ba08325ef8fed97a43d/src/solarLunar.js
 * The lunarInfo table is retained from the same commit. Only calendar-date
 * conversion and Chinese date labels are used; festivals are this app's policy.
 *
 * ISC License
 *
 * Copyright (c) 2015, yize
 *
 * Permission to use, copy, modify, and/or distribute this software for any
 * purpose with or without fee is hereby granted, provided that the above
 * copyright notice and this permission notice appear in all copies.
 *
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
 * WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
 * MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
 * ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
 * WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
 * ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
 * OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
 */

const dates = require('./date');
const MIN_DATE = '1900-01-31';
const MAX_DATE = '2100-12-31';
const FIRST_DAY = Date.parse(MIN_DATE + 'T00:00:00.000Z');
const DAY_MS = 86400000;
const LUNAR_INFO = Object.freeze([0x04bd8, 0x04ae0, 0x0a570, 0x054d5, 0x0d260, 0x0d950, 0x16554, 0x056a0, 0x09ad0, 0x055d2,//1900-1909
  0x04ae0, 0x0a5b6, 0x0a4d0, 0x0d250, 0x1d255, 0x0b540, 0x0d6a0, 0x0ada2, 0x095b0, 0x14977,//1910-1919
  0x04970, 0x0a4b0, 0x0b4b5, 0x06a50, 0x06d40, 0x1ab54, 0x02b60, 0x09570, 0x052f2, 0x04970,//1920-1929
  0x06566, 0x0d4a0, 0x0ea50, 0x06e95, 0x05ad0, 0x02b60, 0x186e3, 0x092e0, 0x1c8d7, 0x0c950,//1930-1939
  0x0d4a0, 0x1d8a6, 0x0b550, 0x056a0, 0x1a5b4, 0x025d0, 0x092d0, 0x0d2b2, 0x0a950, 0x0b557,//1940-1949
  0x06ca0, 0x0b550, 0x15355, 0x04da0, 0x0a5b0, 0x14573, 0x052b0, 0x0a9a8, 0x0e950, 0x06aa0,//1950-1959
  0x0aea6, 0x0ab50, 0x04b60, 0x0aae4, 0x0a570, 0x05260, 0x0f263, 0x0d950, 0x05b57, 0x056a0,//1960-1969
  0x096d0, 0x04dd5, 0x04ad0, 0x0a4d0, 0x0d4d4, 0x0d250, 0x0d558, 0x0b540, 0x0b6a0, 0x195a6,//1970-1979
  0x095b0, 0x049b0, 0x0a974, 0x0a4b0, 0x0b27a, 0x06a50, 0x06d40, 0x0af46, 0x0ab60, 0x09570,//1980-1989
  0x04af5, 0x04970, 0x064b0, 0x074a3, 0x0ea50, 0x06b58, 0x05ac0, 0x0ab60, 0x096d5, 0x092e0,//1990-1999
  0x0c960, 0x0d954, 0x0d4a0, 0x0da50, 0x07552, 0x056a0, 0x0abb7, 0x025d0, 0x092d0, 0x0cab5,//2000-2009
  0x0a950, 0x0b4a0, 0x0baa4, 0x0ad50, 0x055d9, 0x04ba0, 0x0a5b0, 0x15176, 0x052b0, 0x0a930,//2010-2019
  0x07954, 0x06aa0, 0x0ad50, 0x05b52, 0x04b60, 0x0a6e6, 0x0a4e0, 0x0d260, 0x0ea65, 0x0d530,//2020-2029
  0x05aa0, 0x076a3, 0x096d0, 0x04afb, 0x04ad0, 0x0a4d0, 0x1d0b6, 0x0d250, 0x0d520, 0x0dd45,//2030-2039
  0x0b5a0, 0x056d0, 0x055b2, 0x049b0, 0x0a577, 0x0a4b0, 0x0aa50, 0x1b255, 0x06d20, 0x0ada0,//2040-2049
  /**Add By JJonline@JJonline.Cn**/
  0x14b63, 0x09370, 0x049f8, 0x04970, 0x064b0, 0x168a6, 0x0ea50, 0x06b20, 0x1a6c4, 0x0aae0,//2050-2059
  0x092e0, 0x0d2e3, 0x0c960, 0x0d557, 0x0d4a0, 0x0da50, 0x05d55, 0x056a0, 0x0a6d0, 0x055d4,//2060-2069
  0x052d0, 0x0a9b8, 0x0a950, 0x0b4a0, 0x0b6a6, 0x0ad50, 0x055a0, 0x0aba4, 0x0a5b0, 0x052b0,//2070-2079
  0x0b273, 0x06930, 0x07337, 0x06aa0, 0x0ad50, 0x14b55, 0x04b60, 0x0a570, 0x054e4, 0x0d160,//2080-2089
  0x0e968, 0x0d520, 0x0daa0, 0x16aa6, 0x056d0, 0x04ae0, 0x0a9d4, 0x0a4d0, 0x0d150, 0x0f252,//2090-2099
  0x0d520 //2100
]);
const MONTH_NAMES = ['正', '二', '三', '四', '五', '六', '七', '八', '九', '十', '冬', '腊'];
const DIGITS = ['日', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
const DAY_PREFIXES = ['初', '十', '廿'];
const FESTIVALS = Object.freeze({
  '1-1': '春节', '1-15': '元宵', '5-5': '端午', '7-7': '七夕',
  '8-15': '中秋', '9-9': '重阳', '12-8': '腊八'
});

function yearDays(year) {
  const info = LUNAR_INFO[year - 1900];
  let total = 348;
  for (let bit = 0x8000; bit >= 0x10; bit >>= 1) if (info & bit) total += 1;
  return total + ((info & 0xf) ? ((info & 0x10000) ? 30 : 29) : 0);
}

function convert(date) {
  if (date < MIN_DATE || date > MAX_DATE) return null;
  let offset = (Date.parse(date + 'T00:00:00.000Z') - FIRST_DAY) / DAY_MS;
  let year = 1900;
  while (offset >= yearDays(year)) { offset -= yearDays(year); year += 1; }
  const info = LUNAR_INFO[year - 1900];
  const leapMonth = info & 0xf;
  for (let month = 1; month <= 12; month += 1) {
    const count = (info & (0x10000 >> month)) ? 30 : 29;
    if (offset < count) return { lYear: year, lMonth: month, lDay: offset + 1, isLeap: false };
    offset -= count;
    if (month === leapMonth) {
      const leapCount = (info & 0x10000) ? 30 : 29;
      if (offset < leapCount) return { lYear: year, lMonth: month, lDay: offset + 1, isLeap: true };
      offset -= leapCount;
    }
  }
  throw Error('农历日期转换失败');
}

function dayName(day) {
  if (day === 10) return '初十';
  if (day === 20) return '二十';
  if (day === 30) return '三十';
  return DAY_PREFIXES[Math.floor(day / 10)] + DIGITS[day % 10];
}

/** Read-only date projection. Out-of-range dates keep their Gregorian calendar. */
function lunarDate(date) {
  dates.assertDate(date);
  const lunar = convert(date);
  if (!lunar) return null;
  const monthCn = (lunar.isLeap ? '闰' : '') + MONTH_NAMES[lunar.lMonth - 1] + '月';
  const dayCn = dayName(lunar.lDay);
  let festival = lunar.isLeap ? '' : (FESTIVALS[lunar.lMonth + '-' + lunar.lDay] || '');
  if (!lunar.isLeap && !festival) {
    // 除夕可能是腊月二十九或三十；用下一天春节判定，避免固定日期造成误标。
    const next = convert(dates.shift(date, 1));
    if (next && !next.isLeap && next.lMonth === 1 && next.lDay === 1) festival = '除夕';
  }
  return { ...lunar, monthCn, dayCn, festival,
    shortLabel: festival || (lunar.lDay === 1 ? monthCn : dayCn),
    fullLabel: '农历' + monthCn + dayCn };
}

module.exports = { lunarDate };
