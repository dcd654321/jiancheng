'use strict';

const { syncPresentation } = require('./sync-presentation');

function stateError(status) {
  const waiting = status.phase === 'loading' && !status.lastError;
  const error = Error(waiting ? '正在读取云端记录' : status.lastError || '云端记录暂不可用，请联网重试');
  error.code = waiting ? 'DATA_LOADING' : 'DATA_UNAVAILABLE';
  return error;
}

function createWorkspaceStore(session, noteDrafts) {
  let generation = 0;
  function ready() {
    const status = session.status();
    if (!status.ready) throw stateError(status);
    return status;
  }
  return {
    read() { ready(); return session.read(); },
    // 刷新失败但会话仍持有本账户已确认快照时的只读内容；无快照或写入待核对时返回 null。
    stale() { return typeof session.staleRead === 'function' ? session.staleRead() : null; },
    dispatch(command) { ready(); return session.dispatch(command); },
    contextKey() {
      const status = session.status();
      return `cloud:${status.accountId || 'unbound'}:${status.epoch || ''}:${generation}`;
    },
    info() {
      const status = session.status();
      return {
        source: 'cloud', ready: status.ready, phase: status.phase,
        pending: status.pending || 0, deletionPending: !!status.deletionPending,
        conflict: status.conflict || null, lastError: status.lastError || '',
        lastSyncedAt: status.lastSyncedAt || '', ...syncPresentation(status)
      };
    },
    async clear(confirmation) {
      ready();
      const result = await session.purge(confirmation);
      if (noteDrafts) noteDrafts.clear();
      generation += 1;
      return result;
    }
  };
}

module.exports = { createWorkspaceStore };
