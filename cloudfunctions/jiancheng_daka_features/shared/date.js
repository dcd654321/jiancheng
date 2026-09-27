const DAY_MS = 86400000;

function assertDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw Error('日期格式无效');
  const time = Date.parse(value + 'T00:00:00.000Z');
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) throw Error('日期无效');
  return value;
}

function today(now = Date.now()) {
  return new Date(now + 8 * 3600000).toISOString().slice(0, 10);
}

function shift(date, amount) {
  assertDate(date);
  return new Date(Date.parse(date + 'T00:00:00.000Z') + amount * DAY_MS).toISOString().slice(0, 10);
}

function weekday(date) {
  assertDate(date);
  return new Date(date + 'T00:00:00.000Z').getUTCDay() || 7;
}

function range(end, days) {
  assertDate(end);
  if (!Number.isInteger(days) || days < 1 || days > 3660) throw Error('日期范围无效');
  return Array.from({ length: days }, (_, index) => shift(end, index + 1 - days));
}

function label(date) {
  assertDate(date);
  return `${Number(date.slice(5, 7))}月${Number(date.slice(8))}日 周${'一二三四五六日'[weekday(date) - 1]}`;
}

module.exports = { today, shift, weekday, range, label, assertDate };
