'use strict';
// Exclusive to 渐成习惯打卡 in a shared environment. No legacy collection fallback.
const COLLECTION = 'jiancheng_daka_accounts';
const PREFERENCES = 'jiancheng_daka_preferences';
const { readPreferences } = require('./preferences');

function isMissingDocument(err) {
  // Fail closed: missing collections, permission errors and outages must never create empty replacement accounts.
  return /document.*(?:does not exist|not exist)/i.test(String(err && (err.errMsg || err.message))) && !/collection|permission/i.test(String(err && (err.errMsg || err.message)));
}

function createRepository(db, { supervisionEnabled = false } = {}) {
  return {
    async read(owner) {
      try {
        const response = await db.collection(COLLECTION).doc(owner).get();
        if (!response || !Object.prototype.hasOwnProperty.call(response, 'data')) throw Error('ACCOUNT_READ_INVALID');
        if (Array.isArray(response.data) ? response.data.length > 1 : response.data !== null && typeof response.data !== 'object') throw Error('ACCOUNT_READ_INVALID');
        const data = Array.isArray(response.data) ? response.data[0] : response.data;
        if (Array.isArray(response.data) && response.data.length && (!data || typeof data !== 'object' || Array.isArray(data))) throw Error('ACCOUNT_READ_INVALID');
        if (data && !data.payload) throw Error('ACCOUNT_DOCUMENT_CORRUPT');
        return data ? data.payload : null;
      } catch (err) { if (isMissingDocument(err)) return null; throw err; }
    },
    async transact(owner, operation) {
      const result = await db.runTransaction(async transaction => {
        const ref = transaction.collection(COLLECTION).doc(owner);
        let saved = null;
        let _monitorFence;
        try {
          const response = await ref.get();
          const data = Array.isArray(response.data) ? response.data[0] : response.data;
          if (data) saved = data.payload;
          if (data) _monitorFence = data._monitorFence;
          if (data && !saved) throw Error('ACCOUNT_DOCUMENT_CORRUPT');
        } catch (err) { if (!isMissingDocument(err)) throw err; }
        // 清理流程会原地删除标记，须在回调前保留原值以判断是否需要持久化。
        const before = JSON.stringify(saved);
        const previousEpoch = saved && saved.epoch;
        const previousIds = saved && saved.state ? saved.state.habits.map(h => h.id) : [];
        // The guard and account snapshot share this native database transaction.
        // Keep this adapter enabled after closing new invitations if records exist.
        const adapter = supervisionEnabled ? require('./supervision-repository').createSupervisionTx(transaction, owner) : undefined;
        const outcome = await operation(saved, adapter);
        // 单项删除保留账户代际；置顶与账户数据必须在同一事务中提交。
        if (previousEpoch && previousEpoch === outcome.account.epoch) {
          const remaining = new Set(outcome.account.state.habits.map(h => h.id));
          const removed = previousIds.filter(id => !remaining.has(id));
          if (removed.length) {
            const prefRef = transaction.collection(PREFERENCES).doc(owner);
            let pref = null;
            try {
              const response = await prefRef.get();
              pref = Array.isArray(response.data) ? response.data[0] : response.data;
            } catch (err) { if (!isMissingDocument(err)) throw err; }
            if (pref) {
              readPreferences(pref, owner, previousEpoch, outcome.account.updatedAt);
              if (removed.includes(pref.pinnedHabitId)) {
                if (pref.revision === Number.MAX_SAFE_INTEGER) throw Error('PREFERENCES_REVISION_OVERFLOW');
                pref.pinnedHabitId = null; pref.revision += 1; pref.updatedAt = outcome.account.updatedAt;
                const { _id, ...data } = pref;
                await prefRef.set({ data });
              }
            }
          }
        }
        if (!saved || before !== JSON.stringify(outcome.account)) {
          await ref.set({ data: { payload: outcome.account, ...(_monitorFence === undefined ? {} : { _monitorFence }) } });
        }
        return outcome.result;
      });
      // SDK adapters expose either the direct return value or { result }.
      return result && typeof result.ok === 'boolean' ? result : result.result;
    }
  };
}
module.exports = { createRepository, isMissingDocument, COLLECTION };
