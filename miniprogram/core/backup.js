const domain = require('./habits');
const dates = require('./date');
const MAX_BYTES = 1024 * 1024;

// No Buffer/TextEncoder dependency: runs in the native mini-program JS runtime.
function byteLength(text) {
  let size = 0;
  for (const char of text) {
    const point = char.codePointAt(0);
    size += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
  }
  return size;
}
function fields(value, names) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== names.length
    || names.some(name => !Object.prototype.hasOwnProperty.call(value, name))) {
    throw Error('备份包含缺失或不支持的字段，请选择本小程序导出的本机JSON备份');
  }
}
function revision(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 1000000000) throw Error('备份版本计数无效');
}

function parseBackup(raw, today = dates.today()) {
  if (typeof raw !== 'string' || raw.length > MAX_BYTES || byteLength(raw) > MAX_BYTES) throw Error('备份不能超过1MB');
  let state;
  try { state = JSON.parse(raw.replace(/^\ufeff/, '')); } catch (_) { throw Error('不是有效的JSON备份，未修改任何记录'); }
  if (state && (state.current || state.accountId || state.queue || state.epoch)) throw Error('这是云账户备份，暂不支持恢复到本机；不会自动合并');
  fields(state, ['schemaVersion', 'revision', 'habits', 'records', 'settings']);
  if (state.schemaVersion !== 1) throw Error('暂不支持此备份版本，请更新小程序后重试');
  revision(state.revision); fields(state.settings, ['hideQuote']);
  if (!Array.isArray(state.habits) || state.habits.length > 100) throw Error('备份最多支持100个习惯（含归档）');
  if (!state.records || typeof state.records !== 'object' || Array.isArray(state.records) || Object.keys(state.records).length > 20000) throw Error('备份记录数量或格式不受支持');
  const earliest = dates.shift(today, -3650), tomorrow = dates.shift(today, 1);
  function boundedDate(value, end) {
    dates.assertDate(value);
    if (value < earliest || value > end) throw Error('仅支持近10年的备份，计划最晚明天生效，打卡不能晚于今天');
  }
  let versions = 0;
  state.habits.forEach(h => {
    fields(h, ['id', 'createdDate', 'revision', 'versions']); revision(h.revision); boundedDate(h.createdDate, today);
    if (!Array.isArray(h.versions) || (versions += h.versions.length) > 4000) throw Error('备份计划版本数量不受支持');
    h.versions.forEach(v => {
      fields(v, ['title', 'target', 'minimum', 'unit', 'weekdays', 'time', 'effectiveDate', 'status', 'revision']);
      revision(v.revision); boundedDate(v.effectiveDate, tomorrow);
      if (typeof v.title !== 'string' || v.title !== v.title.trim() || typeof v.time !== 'string'
        || !Array.isArray(v.weekdays) || v.weekdays.length > 7 || new Set(v.weekdays).size !== v.weekdays.length) throw Error('备份计划字段类型无效');
    });
  });
  Object.keys(state.records).forEach(key => {
    const r = state.records[key];
    fields(r, ['id', 'date', 'versionRevision', 'todayTarget', 'status', 'note']);
    revision(r.versionRevision); boundedDate(r.date, today);
  });
  domain.validateState(state);
  [today, tomorrow].forEach(day => {
    const active = state.habits.filter(h => { const v = domain.versionAt(h, day); return v && v.status === 'active'; });
    if (active.length > 5) throw Error('备份同时进行的习惯超过5个，暂不支持恢复');
  });
  return state;
}

function describe(state) {
  const recorded = Object.values(state.records);
  return { habits: state.habits.length, records: recorded.length,
    completed: recorded.filter(r => r.status !== 'pending').length,
    latest: recorded.map(r => r.date).sort().slice(-1)[0] || '暂无记录' };
}
module.exports = { MAX_BYTES, byteLength, parseBackup, describe };
