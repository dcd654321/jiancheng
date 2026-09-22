const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const domain = require('../miniprogram/core/habits');
const dates = require('../miniprogram/core/date');
const { parseBackup, byteLength, MAX_BYTES } = require('../miniprogram/core/backup');
const { createStore, STORAGE_KEY, RECOVERY_KEY } = require('../miniprogram/services/store');
const { createWorkspaceStore } = require('../miniprogram/services/workspace-store');
const day = dates.today();
function sample() {
  const state = domain.reduce(domain.emptyState(), { type: 'create', id: 'read', startDate: day,
    plan: { title: '阅读', target: 10, minimum: 2, unit: '分钟', weekdays: [1, 2, 3, 4, 5, 6, 7], time: '20:00' } }, day);
  return domain.reduce(state, { type: 'complete', id: 'read', date: day }, day);
}
function fixture() {
  const data = {}, writes = [];
  const storage = { getStorageSync: k => data[k], setStorageSync(k, v) { writes.push(k); if (storage.fail === k) throw Error('quota'); data[k] = v; },
    removeStorageSync: k => { delete data[k]; } };
  return { data, storage, writes, store: createStore(storage, () => day) };
}
const raw = () => JSON.stringify(sample());
const bad = change => { const s = sample(); change(s); return JSON.stringify(s); };

test('本机JSON往返与UTF8/BOM处理，无联网依赖', () => {
  assert.deepEqual(parseBackup('\ufeff' + raw(), day), sample());
  assert.equal(byteLength('A中😀'), Buffer.byteLength('A中😀'));
  const f = fixture(); assert.deepEqual(parseBackup(f.store.rawBackup(), day), domain.emptyState());
  const preview = f.store.previewBackup(raw());
  assert.deepEqual(preview.summary, { habits: 1, records: 1, completed: 1, latest: day });
  assert.deepEqual(f.writes, []);
});
test('非法JSON、非本机备份、新schema和额外字段拒绝', () => {
  for (const text of ['broken', 'null', '[]', '{"current":{}}', '{"__proto__":{}}', bad(s => { s.schemaVersion = 2; }),
    bad(s => { s.extra = true; }), bad(s => { s.habits[0].versions[0].unknown = 'x'; })]) assert.throws(() => parseBackup(text, day));
  assert.equal({}.polluted, undefined);
});
test('备份限额先于恢复：UTF8体积、习惯数、记录数、版本数', () => {
  assert.throws(() => parseBackup('中'.repeat(Math.ceil(MAX_BYTES / 3)), day), /1MB/);
  assert.throws(() => parseBackup(bad(s => { s.habits = Array(101).fill(s.habits[0]); }), day), /100个/);
  const many = domain.emptyState(); many.records = Object.fromEntries(Array.from({ length: 20001 }, (_, n) => [n, null]));
  assert.throws(() => parseBackup(JSON.stringify(many), day), /数量/);
  assert.throws(() => parseBackup(bad(s => { s.habits[0].versions = Array(4001).fill(null); }), day), /版本数量/);
});
test('备份日期与领域不变量：过去范围、未来打卡、重复ID、无效数量', () => {
  const mutations = [
    s => { s.habits[0].createdDate = '1900-01-01'; },
    s => { s.habits[0].versions[0].effectiveDate = dates.shift(day, 2); },
    s => { const r = s.records['read@' + day]; r.date = dates.shift(day, 1); s.records = { ['read@' + r.date]: r }; },
    s => { s.habits.push(s.habits[0]); },
    s => { s.habits[0].versions[0].weekdays = [1, 1]; },
    s => { s.habits[0].versions[0].target = '10'; },
    s => { s.records['read@' + day].todayTarget = 999; },
    s => { s.revision = Number.MAX_SAFE_INTEGER; },
    s => { s.habits[0].versions[0].title = ' read '; },
    s => { s.habits[0].id = '__proto__'; }
  ];
  mutations.forEach(m => assert.throws(() => parseBackup(bad(m), day)));
});
test('不能通过导入绕过最多5个活跃习惯', () => {
  const s = sample(); s.records = {};
  s.habits = Array.from({ length: 6 }, (_, n) => ({ ...s.habits[0], id: 'h' + n }));
  assert.throws(() => parseBackup(JSON.stringify(s), day), /超过5个/);
});
test('预览不写，未确认不写，恢复先保存旧记录，恢复相同数据不改副本', () => {
  const f = fixture(), before = f.store.rawBackup(), preview = f.store.previewBackup(raw());
  assert.throws(() => f.store.restoreBackup(preview, ''), /确认/); assert.deepEqual(f.writes, []);
  assert.equal(f.store.restoreBackup(preview, 'RESTORE_LOCAL').changed, true);
  assert.deepEqual(f.writes, [RECOVERY_KEY, STORAGE_KEY]); assert.equal(f.store.recoveryBackup(), before);
  assert.deepEqual(f.store.read(), sample());
  assert.equal(f.store.restoreBackup(f.store.previewBackup(raw()), 'RESTORE_LOCAL').changed, false);
  assert.equal(f.writes.length, 2); assert.equal(f.store.recoveryBackup(), before);
});
test('预览后新增记录，恢复被拒绝且不改变当前记录或副本', () => {
  const f = fixture(), preview = f.store.previewBackup(raw());
  f.store.dispatch({ type: 'settings', hideQuote: true }); const before = f.store.rawBackup(), count = f.writes.length;
  assert.throws(() => f.store.restoreBackup(preview, 'RESTORE_LOCAL'), /已变化/);
  assert.equal(f.store.rawBackup(), before); assert.equal(f.writes.length, count);
});
test('恢复前备份失败不覆盖；主记录写失败仍保留原始记录', () => {
  const f = fixture(), preview = f.store.previewBackup(raw()); f.storage.fail = RECOVERY_KEY;
  assert.throws(() => f.store.restoreBackup(preview, 'RESTORE_LOCAL'), /副本保存失败/);
  assert.equal(f.data[STORAGE_KEY], undefined);
  f.storage.fail = STORAGE_KEY;
  assert.throws(() => f.store.restoreBackup(preview, 'RESTORE_LOCAL'), /恢复写入失败/);
  assert.equal(f.data[STORAGE_KEY], undefined); assert.equal(f.store.recoveryBackup(), preview.expectedRaw);
});
test('损坏原文也能先保留再恢复；撤回恢复使用相同校验确认流程', () => {
  const f = fixture(); f.data[STORAGE_KEY] = '{broken';
  assert.throws(() => f.store.read());
  f.store.restoreBackup(f.store.previewBackup(raw()), 'RESTORE_LOCAL');
  assert.equal(f.store.recoveryBackup(), '{broken'); assert.deepEqual(f.store.read(), sample());
  assert.throws(() => f.store.previewBackup(f.store.recoveryBackup()));
  f.store.restoreBackup(f.store.previewBackup(JSON.stringify(domain.emptyState())), 'RESTORE_LOCAL');
  assert.equal(f.store.read().habits.length, 0);
  f.store.restoreBackup(f.store.previewBackup(f.store.recoveryBackup()), 'RESTORE_LOCAL');
  assert.deepEqual(f.store.read(), sample());
});
test('删除本机记录会清除恢复副本，其他存储保留', () => {
  const f = fixture(); f.store.restoreBackup(f.store.previewBackup(raw()), 'RESTORE_LOCAL'); f.data.other = 'keep';
  f.store.clear(); assert.equal(f.data.other, 'keep'); assert.equal(f.data[STORAGE_KEY], undefined);
  assert.throws(() => f.store.recoveryBackup(), /没有/);
});
test('cloud workspace exposes old local data only as an unchanged raw export', () => {
  const f = fixture();
  f.store.restoreBackup(f.store.previewBackup(raw()), 'RESTORE_LOCAL');
  const before = f.store.rawBackup();
  const session = {
    status: () => ({ ready: true, phase: 'ready', accountId: 'a'.repeat(64), pending: 0 }),
    read: () => sample(),
    backup: () => '{"format":"yidian-cloud-backup-v1"}'
  };
  const workspace = createWorkspaceStore(f.store, session);
  assert.equal(workspace.legacyBackup(), before);
  assert.equal(workspace.hasLegacyData(), true);
  assert.equal(workspace.previewBackup, undefined);
  assert.equal(workspace.restoreBackup, undefined);
  assert.equal(workspace.recoveryBackup, undefined);
  assert.equal(f.store.rawBackup(), before);
});

test('backup hub exports cloud and legacy snapshots without importing either one', () => {
  const writes = [], sends = [];
  const store = {
    read: () => domain.emptyState(),
    contextKey: () => 'cloud:test:0',
    info: () => ({ source: 'cloud', ready: true, phase: 'ready', pending: 0, syncText: '数据已同步' }),
    rawBackup: () => '{"kind":"cloud"}',
    legacyBackup: () => '{"kind":"legacy"}',
    hasLegacyData: () => true
  };
  global.getApp = () => ({ store });
  global.wx = {
    env: { USER_DATA_PATH: '/files' },
    getFileSystemManager: () => ({ writeFile: value => { writes.push(value); value.success(); } }),
    shareFileMessage: value => sends.push(value)
  };
  let definition;
  global.Page = value => { definition = value; };
  const source = path.resolve(__dirname, '../miniprogram/pages/restore/index.js');
  delete require.cache[source]; require(source);
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch) { Object.assign(this.data, patch); } };
  page.refresh();
  assert.equal(page.data.dataReady, true);
  assert.equal(page.data.hasLegacyData, true);
  page.onCloudBackup();
  page.onLegacyBackup();
  assert.equal(writes[0].data, '{"kind":"cloud"}');
  assert.equal(writes[0].filePath, '/files/yidian-cloud-sync-backup.json');
  assert.equal(writes[1].data, '{"kind":"legacy"}');
  assert.equal(writes[1].filePath, '/files/yidian-legacy-backup.json');
  assert.equal(sends.length, 2);
  assert.equal(page.onChoose, undefined);
  assert.equal(page.onRestore, undefined);
});
