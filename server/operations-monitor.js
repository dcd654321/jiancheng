'use strict';
const crypto = require('node:crypto');
const { callerIdentity } = require('./identity');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const MONITOR_WAIT_MS = 500;

async function settleMonitoring(work, onFailure = () => {}) {
  let timer, finished = false;
  const report = code => { if (!finished) { try { onFailure(code); } catch (_) {} } };
  const pending = Promise.resolve().then(work).then(() => true, () => { report('MONITOR_WRITE_FAILED'); return false; });
  const deadline = new Promise(resolve => { timer = setTimeout(() => { report('MONITOR_WRITE_TIMEOUT'); resolve(false); }, MONITOR_WAIT_MS); });
  try { return await Promise.race([pending, deadline]); }
  finally { finished = true; clearTimeout(timer); }
}

function isMissingCollection(error) {
  return error && [error.errCode, error.code].some(code => [-502005, '-502005', 'DATABASE_COLLECTION_NOT_EXIST', 'TCB_DB_COLLECTION_NOT_EXISTS'].includes(code));
}

function confirmedMetric(before, after, event) {
  if (event.action !== 'mutate') return null;
  const command = event.command;
  let type, payload = {};
  if (command.type === 'create' && !before.habits.some(h => h.id === command.id) && after.habits.some(h => h.id === command.id)) {
    type = 'habit_created';
  } else if (['complete', 'completeMinimum'].includes(command.type)) {
    const key = command.id + '@' + event.operationDate, previous = before.records[key], saved = after.records[key];
    if (saved && ['standard', 'minimum'].includes(saved.status) && (!previous || previous.status === 'pending')) {
      type = 'checkin_completed'; payload = { recordDate: saved.date, status: saved.status };
    }
  }
  if (!type) return null;
  if (event.sessionId) payload.sessionId = event.sessionId;
  return { type, payload, accountGeneration: event.epoch, eventId: hash(event.epoch + '|' + event.operationId + '|' + type) };
}

async function optionalDocument(reference) {
  try {
    const result = await reference.get();
    if (!result || !Object.prototype.hasOwnProperty.call(result, 'data')) throw Error('MONITOR_DOCUMENT_INVALID');
    return (Array.isArray(result.data) ? result.data[0] : result.data) || null;
  } catch (error) {
    if (/document.*(?:does not exist|not exist)/i.test(String(error && (error.errMsg || error.message))) && !/collection|permission/i.test(String(error && (error.errMsg || error.message)))) return null;
    throw error;
  }
}

function monitorIdentity(identity) {
  const caller = callerIdentity(identity);
  if (!caller || caller.APPID !== 'wx58e61dffcbfa4249' || typeof caller.OPENID !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(caller.OPENID)) throw Error('MONITOR_IDENTITY_INVALID');
  return { owner: hash(caller.APPID + ':' + caller.OPENID), userId: 'user_' + hash(caller.APPID + '|' + caller.OPENID).slice(0, 24) };
}

function createOperationsReporter(db) {
  return async (metric, identity, now) => {
    const { owner, userId: sourceUserId } = monitorIdentity(identity);
    const id = 'evt_' + hash('jiancheng|' + sourceUserId + '|' + metric.eventId);
    return db.runTransaction(async tx => {
      const accountRef = tx.collection('jiancheng_daka_accounts').doc(owner);
      const reference = tx.collection('monitor_events').doc(id);
      const [account, previous] = await Promise.all([
        optionalDocument(accountRef), optionalDocument(reference)
      ]);
      if (!account || !account.payload || account.payload.epoch !== metric.accountGeneration || account.payload.cleanupPending || previous) return false;
      // Snapshot reads alone do not conflict with purge. Write the same account
      // so a concurrent epoch change forces a retry and a fresh barrier check.
      await accountRef.update({ data: { _monitorFence: db.command.inc(1) } });
      await reference.set({ data: {
        appId: 'jiancheng', type: metric.type, sourceUserId, occurredAt: new Date(now), createdAt: new Date(now),
        eventId: metric.eventId, accountGeneration: metric.accountGeneration, payload: metric.payload
      } });
      return true;
    });
  };
}

function createOperationsCleanup(db) {
  return async (owner, oldEpoch, identity) => {
    const actor = monitorIdentity(identity);
    if (actor.owner !== owner || !/^[A-Za-z0-9_-]{1,100}$/.test(oldEpoch)) throw Error('MONITOR_CLEANUP_SCOPE_INVALID');
    const account = await optionalDocument(db.collection('jiancheng_daka_accounts').doc(owner));
    if (!account || !account.payload || !account.payload.cleanupPending || account.payload.cleanupSourceEpoch !== oldEpoch) throw Error('MONITOR_CLEANUP_NOT_PENDING');
    for (const [name, identityField] of [['monitor_users', 'userId'], ['monitor_usage_daily', 'userId'], ['monitor_usage_sessions', 'userId'], ['monitor_events', 'sourceUserId']]) {
      let empty = false;
      for (let batch = 0; batch < 20; batch++) {
        let response;
        try { response = await db.collection(name).where({ appId: 'jiancheng', [identityField]: actor.userId }).limit(20).get(); }
        catch (error) {
          // A never-created collection contains no personal records to delete.
          // Only the SDK's precise missing-collection code is safe to skip.
          if (isMissingCollection(error)) { empty = true; break; }
          throw error;
        }
        if (!response || !Array.isArray(response.data)) throw Error('MONITOR_CLEANUP_RESPONSE_INVALID');
        if (!response.data.length) { empty = true; break; }
        for (const row of response.data) {
          if (row.appId !== 'jiancheng' || row[identityField] !== actor.userId || typeof row._id !== 'string') throw Error('MONITOR_CLEANUP_ROW_INVALID');
        }
        const deleting = await db.runTransaction(async tx => {
          const accountRef = tx.collection('jiancheng_daka_accounts').doc(owner);
          const current = await optionalDocument(accountRef);
          if (!current || !current.payload || !current.payload.cleanupPending || current.payload.cleanupSourceEpoch !== oldEpoch) return false;
          const targets = await Promise.all(response.data.map(async row => {
            const ref = tx.collection(name).doc(row._id), data = await optionalDocument(ref);
            if (data && (data.appId !== 'jiancheng' || data[identityField] !== actor.userId)) throw Error('MONITOR_CLEANUP_ROW_INVALID');
            return data ? ref : null;
          }));
          await accountRef.update({ data: { _monitorFence: db.command.inc(1) } });
          for (const ref of targets.filter(Boolean)) await ref.remove();
          return true;
        });
        if ((deleting && Object.prototype.hasOwnProperty.call(deleting, 'result') ? deleting.result : deleting) === false) return;
      }
      if (!empty) throw Error('MONITOR_CLEANUP_BATCH_LIMIT');
    }
  };
}
module.exports = { confirmedMetric, createOperationsReporter, createOperationsCleanup, settleMonitoring, MONITOR_WAIT_MS };
