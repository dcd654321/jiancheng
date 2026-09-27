'use strict';
const { fail } = require('./protocol');
const { read, readAccount } = require('./features-repository');
const { COLLECTION } = require('./cloudbase-repository');
const LIMITS = 'jiancheng_daka_limits';
const SCOPES = ['features', 'public', 'reminders', 'ai', 'reminder-send'];
const PRIVATE_SCOPES = ['features', 'reminders', 'ai'];
const denied = () => fail('RATE_LIMITED', '访问次数已达上限，请稍后再试');
const valid = n => Number.isSafeInteger(n) && n > 0 && n <= 1000000;
function configuration(env, prefix, user = true) {
  const result = {};
  for (const key of ['minute', 'day', ...(user ? ['userMinute','userDay'] : [])]) {
    const raw = env[prefix + '_' + key.replace(/[A-Z]/g, c => '_' + c).toUpperCase()];
    if (typeof raw !== 'string' || !/^[1-9]\d{0,6}$/.test(raw) || !valid(Number(raw))) throw Error('LIMIT_CONFIG_REQUIRED');
    result[key] = Number(raw);
  }
  return result;
}
function bucket(saved, minute, day, maxMinute, maxDay) {
  if (saved && (saved.schemaVersion !== 1 || !Number.isSafeInteger(saved.minute) || !Number.isSafeInteger(saved.day) ||
    !Number.isSafeInteger(saved.minuteUsed) || saved.minuteUsed < 0 || !Number.isSafeInteger(saved.dayUsed) || saved.dayUsed < 0)) throw Error('LIMIT_DOCUMENT_CORRUPT');
  if (saved && (saved.minute > minute || saved.day > day)) return { until: (saved.minute + 1) * 60000 };
  const next = { schemaVersion: 1, minute, day, minuteUsed: saved && saved.minute === minute ? saved.minuteUsed : 0,
    dayUsed: saved && saved.day === day ? saved.dayUsed : 0 };
  if (next.dayUsed >= maxDay) return { until: (day + 1) * 86400000 - 28800000 };
  if (next.minuteUsed >= maxMinute) return { until: (minute + 1) * 60000 };
  next.minuteUsed++; next.dayUsed++; return { next };
}
function createLimitRepository(db) {
  return {
    transact(work) {
      return db.runTransaction(tx => work({
        read: id => read(tx.collection(LIMITS).doc(id)),
        account: owner => readAccount(tx.collection(COLLECTION).doc(owner)),
        put: (id, data) => tx.collection(LIMITS).doc(id).set({ data })
      })).then(outcome => outcome && typeof outcome.ok === 'boolean' ? outcome : outcome.result);
    }
  };
}
function createLimiter({ repository, scope, limits, clock = Date.now }) {
  if (!SCOPES.includes(scope) || !valid(limits.minute) || !valid(limits.day) ||
    (PRIVATE_SCOPES.includes(scope) && (!valid(limits.userMinute) || !valid(limits.userDay)))) throw Error('LIMIT_CONFIG_REQUIRED');
  const blocked = new Map();
  return async (owner, epoch) => {
    const now = clock(), minute = Math.floor(now / 60000), day = Math.floor((now + 28800000) / 86400000);
    if (!Number.isSafeInteger(minute) || now < 0) throw Error('LIMIT_CLOCK_INVALID');
    const globalId = 'global-' + scope;
    const userId = owner ? scope + '-' + owner : null;
    if (PRIVATE_SCOPES.includes(scope) && (!owner || !epoch)) fail('UNAUTHORIZED', '账户身份无效');
    if (!PRIVATE_SCOPES.includes(scope) && owner) throw Error('PUBLIC_LIMIT_HAS_OWNER');
    for (const [key, until] of blocked) if (until <= now) blocked.delete(key);
    if (blocked.has(globalId) || (userId && blocked.has(userId))) denied();
    const result = await repository.transact(async tx => {
      if (userId) {
        const account = await tx.account(owner);
        if (!account) fail('ACCOUNT_REQUIRED', '请先进入今日页开始使用');
        if (account.cleanupPending) fail('DELETE_PENDING', '个人数据正在删除，请稍后重试');
        if (account.epoch !== epoch) fail('EPOCH_CHANGED', '账户数据已变化，请重新打开');
      }
      const global = bucket(await tx.read(globalId), minute, day, limits.minute, limits.day);
      if (!global.next) return { ok: false, key: globalId, until: global.until };
      let user;
      if (userId) {
        const saved = await tx.read(userId);
        if (saved && (saved.owner !== owner || saved.ownerEpoch !== epoch)) throw Error('LIMIT_OWNER_MISMATCH');
        user = bucket(saved, minute, day, limits.userMinute, limits.userDay);
        if (!user.next) return { ok: false, key: userId, until: user.until };
      }
      await tx.put(globalId, global.next);
      if (userId) await tx.put(userId, { ...user.next, owner, ownerEpoch: epoch });
      return { ok: true };
    });
    if (!result.ok) {
      if (blocked.size >= 512) blocked.delete(blocked.keys().next().value);
      blocked.set(result.key, result.until); denied();
    }
  };
}
module.exports = { LIMITS, SCOPES, PRIVATE_SCOPES, configuration, createLimitRepository, createLimiter };
