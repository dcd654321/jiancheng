'use strict';
const { COLLECTION: ACCOUNTS, isMissingDocument } = require('./cloudbase-repository');
const PREFERENCES = 'jiancheng_daka_preferences';
const SHARES = 'jiancheng_daka_shares';
async function read(ref) {
  try {
    const response = await ref.get();
    const data = Array.isArray(response.data) ? response.data[0] : response.data;
    return data || null;
  } catch (err) { if (isMissingDocument(err)) return null; throw err; }
}
async function readAccount(ref) {
  const doc = await read(ref);
  if (doc && !doc.payload) throw Error('ACCOUNT_DOCUMENT_CORRUPT');
  return doc && doc.payload;
}
function createFeaturesRepository(db) {
  return {
    async transact(owner, operation) {
      const outcome = await db.runTransaction(async tx => {
        const prefRef = tx.collection(PREFERENCES).doc(owner);
        return operation({
          account: () => readAccount(tx.collection(ACCOUNTS).doc(owner)),
          preferences: () => read(prefRef),
          share: id => read(tx.collection(SHARES).doc(id)),
          putPreferences: pref => {
            const { _id, ...data } = pref;
            return prefRef.set({ data });
          },
          putShare: share => {
            const { _id, ...data } = share;
            return tx.collection(SHARES).doc(_id).set({ data });
          },
          removeShare: id => tx.collection(SHARES).doc(id).remove()
        });
      });
      return outcome && typeof outcome.ok === 'boolean' ? outcome : outcome.result;
    },
    share: id => read(db.collection(SHARES).doc(id)),
    account: owner => readAccount(db.collection(ACCOUNTS).doc(owner))
  };
}
module.exports = { createFeaturesRepository, PREFERENCES, SHARES, read, readAccount };
