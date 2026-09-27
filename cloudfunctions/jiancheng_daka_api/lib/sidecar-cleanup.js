'use strict';
const { PREFERENCES, SHARES, read } = require('./features-repository');
// Account tombstone blocks new writes while this runs. Queries exclude new epochs.
function createSidecarCleanup(db, { remindersEnabled = false } = {}) {
  const collections = [SHARES, ...(remindersEnabled ? ['jiancheng_daka_reminders'] : [])];
  return async (owner, ownerEpoch) => {
    if (!/^[a-f0-9]{64}$/.test(owner) || !/^[a-zA-Z0-9_-]{1,100}$/.test(ownerEpoch)) throw Error('INVALID_CLEANUP_SCOPE');
    for (const name of collections) {
      let empty = false;
      for (let batch = 0; batch < 20; batch++) {
        const response = await db.collection(name).where({ owner, ownerEpoch }).limit(20).get();
        if (!response || !Array.isArray(response.data)) throw Error('INVALID_CLEANUP_RESPONSE');
        if (!response.data.length) { empty = true; break; }
        for (const row of response.data) {
          if (row.owner !== owner || row.ownerEpoch !== ownerEpoch || typeof row._id !== 'string') throw Error('INVALID_CLEANUP_ROW');
          await db.collection(name).doc(row._id).remove();
        }
      }
      if (!empty) throw Error('CLEANUP_BATCH_LIMIT');
    }
    // Preference key is reused across epochs; do not remove a newly created preference.
    await db.runTransaction(async tx => {
      const ref = tx.collection(PREFERENCES).doc(owner), pref = await read(ref);
      if (pref && pref.owner === owner && pref.ownerEpoch === ownerEpoch) await ref.remove();
      else if (pref && pref.owner !== owner) throw Error('INVALID_PREFERENCE_OWNER');
    });
  };
}
module.exports = { createSidecarCleanup };
