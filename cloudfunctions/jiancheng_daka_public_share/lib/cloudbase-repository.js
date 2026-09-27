'use strict';
// Exclusive to 渐成习惯打卡 in a shared environment. No legacy collection fallback.
const COLLECTION = 'jiancheng_daka_accounts';

function isMissingDocument(err) {
  // Fail closed: missing collections, permission errors and outages must never create empty replacement accounts.
  return /document.*(?:does not exist|not exist)/i.test(String(err && (err.errMsg || err.message))) && !/collection|permission/i.test(String(err && (err.errMsg || err.message)));
}

function createRepository(db) {
  return {
    async transact(owner, operation) {
      const result = await db.runTransaction(async transaction => {
        const ref = transaction.collection(COLLECTION).doc(owner);
        let saved = null;
        try {
          const response = await ref.get();
          const data = Array.isArray(response.data) ? response.data[0] : response.data;
          if (data) saved = data.payload;
          if (data && !saved) throw Error('ACCOUNT_DOCUMENT_CORRUPT');
        } catch (err) { if (!isMissingDocument(err)) throw err; }
        const outcome = await operation(saved);
        if (!saved || JSON.stringify(saved) !== JSON.stringify(outcome.account)) {
          await ref.set({ data: { payload: outcome.account } });
        }
        return outcome.result;
      });
      // SDK adapters expose either the direct return value or { result }.
      return result && typeof result.ok === 'boolean' ? result : result.result;
    }
  };
}
module.exports = { createRepository, isMissingDocument, COLLECTION };
