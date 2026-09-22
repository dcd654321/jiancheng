'use strict';

const domain = require('../core/habits');
const dates = require('../core/date');
const { syncPresentation } = require('./sync-presentation');

function stateError(status) {
  const waiting = status.phase === 'loading' && !status.lastError;
  const error = Error(status.phase === 'needsConsent' ? '请先阅读数据说明并开始使用'
    : waiting ? '正在读取记录' : status.lastError || '暂时无法读取记录');
  error.code = status.phase === 'needsConsent' ? 'NEEDS_CONSENT'
    : waiting ? 'DATA_LOADING' : 'DATA_UNAVAILABLE';
  return error;
}

function createWorkspaceStore(legacy, session, noteDrafts) {
  let generation = 0;

  function ready() {
    const status = session.status();
    if (!status.ready) throw stateError(status);
    return status;
  }

  return {
    read() {
      ready();
      return session.read();
    },
    dispatch(command) {
      ready();
      return session.dispatch(command);
    },
    contextKey() {
      const status = session.status();
      return `cloud:${status.accountId || 'unbound'}:${status.epoch || ''}:${generation}`;
    },
    info() {
      const status = session.status();
      return {
        source: 'cloud',
        ready: status.ready,
        phase: status.phase,
        pending: status.pending || 0,
        conflict: status.conflict || null,
        lastError: status.lastError || '',
        lastSyncedAt: status.lastSyncedAt || '',
        ...syncPresentation(status)
      };
    },
    exportCsv(includeNotes) {
      ready();
      return domain.exportCsv(session.read(), dates.today(), includeNotes);
    },
    rawBackup() {
      ready();
      return session.backup();
    },
    hasLegacyData() {
      try {
        return legacy.read().habits.length > 0;
      } catch (_) {
        return true;
      }
    },
    legacyBackup() {
      return legacy.rawBackup();
    },
    async clear(confirmation) {
      ready();
      const result = await session.purge(confirmation);
      if (noteDrafts) noteDrafts.clear();
      legacy.clear();
      generation += 1;
      return result;
    }
  };
}

module.exports = { createWorkspaceStore };
