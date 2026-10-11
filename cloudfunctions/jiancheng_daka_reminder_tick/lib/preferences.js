'use strict';
const { token } = require('./protocol');
const SLOTS = ['08:00', '12:30', '20:30'];
const THEMES = ['mist', 'paper'];

function readPreferences(saved, owner, epoch, now) {
  if (!saved) return { schemaVersion: 1, owner, ownerEpoch: epoch, revision: 0, pinnedHabitId: null, reminderSlot: null,
    updatedAt: now, shareIndex: [], dailyCreates: { date: '', requests: [] }, preferenceReceipts: [] };
  if (saved.schemaVersion !== 1 || saved.owner !== owner || saved.ownerEpoch !== epoch || !Number.isSafeInteger(saved.revision) || saved.revision < 0 ||
    !Array.isArray(saved.shareIndex) || saved.shareIndex.length > 200 || !Array.isArray(saved.preferenceReceipts) || saved.preferenceReceipts.length > 64 ||
    !saved.dailyCreates || typeof saved.dailyCreates.date !== 'string' || !Array.isArray(saved.dailyCreates.requests) || saved.dailyCreates.requests.length > 10 ||
    (saved.pinnedHabitId !== null && !token(saved.pinnedHabitId)) || (saved.reminderSlot !== null && !SLOTS.includes(saved.reminderSlot))) throw Error('PREFERENCES_CORRUPT');
  if (saved.theme !== undefined && !THEMES.includes(saved.theme)) throw Object.assign(Error('PREFERENCES_CORRUPT'), { code: 'PREFERENCES_CORRUPT' });
  const unique = new Set();
  for (const row of saved.shareIndex) {
    if (typeof row.id !== 'string' || !/^[a-f0-9]{64}$/.test(row.id) || unique.has(row.id) || !['active', 'revoked'].includes(row.status) ||
      !Number.isFinite(Date.parse(row.createdAt)) || !Number.isFinite(Date.parse(row.expiresAt))) throw Error('SHARE_INDEX_CORRUPT');
    unique.add(row.id);
  }
  return saved;
}
module.exports = { readPreferences, SLOTS, THEMES };
