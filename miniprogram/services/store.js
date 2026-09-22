const domain = require('../core/habits');
const dates = require('../core/date');
const backup = require('../core/backup');
const STORAGE_KEY = 'yidian.native.v1';
const RECOVERY_KEY = 'yidian.native.restore-recovery.v1';

function createStore(storage, clock = dates.today) {
  function rawBackup() {
    const raw = storage.getStorageSync(STORAGE_KEY);
    return raw === '' || raw == null ? JSON.stringify(domain.emptyState()) : typeof raw === 'string' ? raw : JSON.stringify(raw);
  }
  function recoveryBackup() {
    const raw = storage.getStorageSync(RECOVERY_KEY);
    if (raw === '' || raw == null) throw Error('还没有恢复前副本');
    if (typeof raw !== 'string') throw Error('恢复前副本格式无法读取，请勿清空存储');
    return raw;
  }
  function read() {
    const raw = storage.getStorageSync(STORAGE_KEY);
    if (raw === '' || raw === undefined || raw === null) return domain.emptyState();
    let state;
    try { state = JSON.parse(raw); } catch (_) { throw Error('本机数据无法读取，未覆盖原记录。请先导出原始备份'); }
    return domain.validateState(state);
  }

  function dispatch(command) {
    const previous = read();
    const next = domain.reduce(previous, command, clock());
    domain.validateState(next);
    if (next !== previous) {
      try { storage.setStorageSync(STORAGE_KEY, JSON.stringify(next)); }
      catch (_) { throw Error('本机保存失败，记录未更新。请检查存储空间后重试'); }
    }
    return next;
  }

  return {
    read, dispatch,
    exportCsv: includeNotes => domain.exportCsv(read(), clock(), includeNotes),
    rawBackup, recoveryBackup,
    previewBackup(raw) {
      const state = backup.parseBackup(raw, clock());
      return { raw: JSON.stringify(state), expectedRaw: rawBackup(), summary: backup.describe(state) };
    },
    restoreBackup(preview, confirmation) {
      if (confirmation !== 'RESTORE_LOCAL' || !preview || typeof preview.expectedRaw !== 'string') throw Error('请先预览并确认恢复');
      const next = backup.parseBackup(preview.raw, clock());
      const previous = rawBackup();
      if (previous !== preview.expectedRaw) throw Error('预览后本机记录已变化，请重新选择备份并确认');
      const nextRaw = JSON.stringify(next);
      if (nextRaw === previous) return { changed: false };
      // Persist the pre-image first. A failed backup never permits replacement.
      try { storage.setStorageSync(RECOVERY_KEY, previous); }
      catch (_) { throw Error('恢复前副本保存失败，未覆盖本机记录，请检查存储空间'); }
      try { storage.setStorageSync(STORAGE_KEY, nextRaw); }
      catch (_) { throw Error('恢复写入失败，原记录及恢复前副本已保留'); }
      return { changed: true };
    },
    // Called only after an explicit in-app, two-stage user confirmation.
    clear: () => { storage.removeStorageSync(RECOVERY_KEY); storage.removeStorageSync(STORAGE_KEY); }
  };
}

module.exports = { createStore, STORAGE_KEY, RECOVERY_KEY };
