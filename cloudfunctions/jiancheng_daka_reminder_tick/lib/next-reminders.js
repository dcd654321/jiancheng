'use strict';
const crypto = require('node:crypto');
const { ApiError, fail, token, canonical } = require('./protocol');
const { authenticate, callerIdentity } = require('./identity');
const { reminderId, recipientAAD, STATES } = require('./reminders');

const TYPES = ['self', 'supervisor'];
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const HEX = /^[a-f0-9]{64}$/;
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const hash = value => crypto.createHash('sha256').update(canonical(value)).digest('hex');
const FIELDS = {
  previewReminder: ['type', 'businessDate', 'slot', 'habitIds', 'relationIds'],
  scheduleReminder: ['type', 'businessDate', 'slot', 'habitIds', 'relationIds', 'dueAt', 'sourceRevision', 'scopeFingerprint', 'generation', 'operationId', 'subscriptionResult'],
  getReminders: ['includeTypes'], cancelReminder: ['type', 'businessDate', 'generation']
};
function validateNextRequest(event, dates) {
  if (!event || typeof event !== 'object' || Array.isArray(event) || ![Object.prototype, null].includes(Object.getPrototypeOf(event)) ||
    !own(FIELDS, event.action) || Buffer.byteLength(JSON.stringify(event), 'utf8') > 4096 || !token(event.epoch) ||
    Object.keys(event).some(key => !['action', 'epoch', ...FIELDS[event.action]].includes(key))) fail('INVALID_REQUEST', '提醒请求无效');
  if (event.action === 'getReminders') {
    if (event.includeTypes !== true) fail('INVALID_REQUEST', '提醒列表参数无效');
    return;
  }
  if (!TYPES.includes(event.type)) fail('INVALID_REQUEST', '请选择提醒对象');
  try { dates.assertDate(event.businessDate); } catch (_) { fail('INVALID_REQUEST', '提醒日期无效'); }
  if (event.action === 'cancelReminder') {
    if (!Number.isInteger(event.generation) || event.generation < 1 || event.generation > 8) fail('INVALID_REQUEST', '提醒版本无效');
    return;
  }
  if (event.slot !== undefined && (typeof event.slot !== 'string' || !TIME.test(event.slot))) fail('INVALID_REQUEST', '提醒时间需为HH:mm');
  const selected = event.type === 'self' ? 'habitIds' : 'relationIds';
  const excluded = event.type === 'self' ? 'relationIds' : 'habitIds';
  if (own(event, excluded)) fail('INVALID_REQUEST', '提醒事项与对象不符');
  if (own(event, selected) && (!Array.isArray(event[selected]) || !event[selected].length || event[selected].length > 20 ||
    event[selected].some(id => !token(id)) || new Set(event[selected]).size !== event[selected].length)) fail('INVALID_REQUEST', '请选择有效的提醒事项');
  if (event.action === 'scheduleReminder' && (!TIME.test(event.slot || '') || !Array.isArray(event[selected]) ||
    event.subscriptionResult !== 'accept' || !token(event.operationId) || !HEX.test(event.scopeFingerprint || '') ||
    !Number.isSafeInteger(event.sourceRevision) || event.sourceRevision < 0 || !Number.isInteger(event.generation) ||
    event.generation < 0 || event.generation >= 8 || typeof event.dueAt !== 'string' || !Number.isFinite(Date.parse(event.dueAt)))) {
    fail('INVALID_REQUEST', '请先预览并主动授权本次提醒');
  }
}
function templateFor(options, type) {
  const value = options.templateIds && options.templateIds[type] || (type === 'self' ? options.templateId : null);
  const selfTemplate = options.templateIds && options.templateIds.self || options.templateId;
  if (type === 'supervisor' && value === selfTemplate) return null;
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{10,128}$/.test(value) ? value : null;
}
function publicItem(scope) {
  return { habitId: scope.habitId, title: scope.title, ...(scope.relationId ? { relationId: scope.relationId, deadline: scope.deadline } : {}) };
}
function nextView(doc) {
  if (!doc || doc.schemaVersion !== 2 || !TYPES.includes(doc.type) || !STATES.includes(doc.status) || !TIME.test(doc.slot || '') ||
    !Number.isInteger(doc.generation) || doc.generation < 1 || doc.generation > 8 || !Array.isArray(doc.scopes) || !doc.scopes.length || doc.scopes.length > 20) {
    throw Error('REMINDER_CORRUPT');
  }
  return { type: doc.type, businessDate: doc.businessDate, slot: doc.slot, dueAt: doc.dueAt, generation: doc.generation,
    status: doc.status, updatedAt: doc.updatedAt, items: doc.scopes.map(publicItem) };
}
async function resolveReminderScopes(tx, { account, owner, type, businessDate, habitIds, relationIds, domain, dates, now, includeCompleted = false }) {
  if (type === 'self') {
    const tasks = domain.tasksOn(account.state, businessDate);
    if (habitIds && habitIds.some(id => !account.state.habits.some(h => h.id === id))) fail('INVALID_REQUEST', '只能提醒自己的习惯');
    return tasks.filter(task => task.status === 'pending' && (!habitIds || habitIds.includes(task.id))).map(task => ({
      habitId: task.id, title: task.title, time: task.time, planRevision: task.versionRevision, status: task.status
    })).sort((a, b) => a.habitId.localeCompare(b.habitId));
  }
  if (typeof tx.supervisionIndex !== 'function' || typeof tx.supervision !== 'function') fail('NOT_ENABLED', '监督提醒尚未开放');
  const { listReminderRelations } = require('./supervision');
  // Keep the helper's account lookup within this same recipient transaction.
  const adapter = { ...tx, account: subject => subject ? tx.subjectAccount(subject) : tx.account() };
  const scopes = await listReminderRelations(adapter, { supervisor: owner, supervisorEpoch: account.epoch, relationIds,
    businessDate, now, domain, dates });
  if (!Array.isArray(scopes)) throw Error('REMINDER_SCOPE_INVALID');
  if (scopes.length > 20) fail('CAPACITY_LIMIT', '一次最多预约20项，请选择需要提醒的事项');
  return scopes.filter(scope => includeCompleted || scope.status === 'pending').map(scope => ({ ...scope, graceMinutes: 15 })).sort((a, b) => a.relationId.localeCompare(b.relationId));
}
function appointment(scopes, type, businessDate, slot, dates) {
  if (!scopes.length) fail('NO_SCHEDULE', '这一天没有需要提醒的事项');
  if (type === 'self') {
    const chosen = slot || scopes.map(scope => scope.time).filter(value => TIME.test(value || '')).sort()[0] || '20:00';
    return { slot: chosen, dueAt: new Date(businessDate + 'T' + chosen + ':00+08:00').toISOString() };
  }
  const cutoff = Math.max(...scopes.map(scope => {
    if (!TIME.test(scope.deadline || '')) throw Error('REMINDER_DEADLINE_INVALID');
    return Date.parse(businessDate + 'T' + scope.deadline + ':00+08:00') + 15 * 60000;
  }));
  const deadlineDay = dates.today(cutoff), chosen = slot || new Date(cutoff + 8 * 3600000).toISOString().slice(11, 16);
  const dueAt = new Date(deadlineDay + 'T' + chosen + ':00+08:00');
  if (dueAt.getTime() < cutoff) fail('BEFORE_DEADLINE', '监督提醒不能早于所选事项截止后15分钟');
  return { slot: chosen, dueAt: dueAt.toISOString() };
}
function createNextReminderApi(options) {
  const { repository, domain, dates, allowedAppId, allowedSources, codec, limiter, clock = () => new Date() } = options;
  return async (event, identity) => {
    try {
      const owner = authenticate(identity, allowedAppId, allowedSources);
      validateNextRequest(event, dates);
      if (!codec) fail('NOT_ENABLED', '提醒服务尚未开放');
      if (limiter) await limiter(owner, event.epoch);
      return await repository.transact(owner, async tx => {
        const now = clock(), account = await tx.account(), day = dates.today(now.getTime());
        if (!account) fail('ACCOUNT_REQUIRED', '请先进入今日页开始使用');
        if (account.cleanupPending) fail('DELETE_PENDING', '个人数据正在删除');
        if (account.epoch !== event.epoch) fail('EPOCH_CHANGED', '账户数据已变化，请重新打开');
        domain.validateState(account.state);
        const readOwn = async (businessDate, type) => {
          const doc = await tx.reminder(reminderId(owner, account.epoch, businessDate, type));
          if (doc && (doc.owner !== owner || doc.ownerEpoch !== account.epoch || doc.businessDate !== businessDate || (doc.type || 'self') !== type)) throw Error('REMINDER_OWNER_MISMATCH');
          return doc;
        };
        const view = async doc => {
          if (doc.schemaVersion === 1) return { ...require('./reminders').view(doc), type: 'self', items: [] };
          const result = nextView(doc);
          if (doc.type === 'supervisor') {
            if (typeof tx.supervisionIndex !== 'function') return { ...result, items: [] };
            const current = await resolveReminderScopes(tx, { account, owner, type: doc.type, businessDate: doc.businessDate,
              relationIds: doc.relationIds, domain, dates, now, includeCompleted: true });
            const items = [];
            for (const scope of current) {
              const relation = await tx.supervision(scope.relationId);
              if (relation && relation.status === 'active' && day >= relation.startDate && day <= relation.endDate) items.push(publicItem(scope));
            }
            result.items = items;
          }
          return result;
        };
        if (event.action === 'getReminders') {
          const items = [];
          for (let i = -1; i < 7; i++) for (const type of TYPES) {
            const doc = await readOwn(dates.shift(day, i), type);
            if (doc) items.push(await view(doc));
          }
          return { ok: true, items: items.sort((a, b) => a.dueAt.localeCompare(b.dueAt) || a.type.localeCompare(b.type)) };
        }
        if (event.businessDate < dates.shift(day, -1) || event.businessDate > dates.shift(day, 6)) fail('RECONFIRM_REQUIRED', '提醒日期已变化，请重新预览');
        const doc = await readOwn(event.businessDate, event.type);
        if (event.action === 'cancelReminder') {
          if (!doc) fail('REMINDER_UNAVAILABLE', '没有可取消的提醒');
          if (doc.generation !== event.generation) fail('CONFLICT', '提醒已变化，请刷新');
          if (doc.status === 'cancelled') return { ok: true, reminder: await view(doc) };
          if (doc.status !== 'pending') fail('ALREADY_PROCESSING', '提醒已处理或正在发送，不能撤回在途消息');
          doc.status = 'cancelled'; doc.updatedAt = now.toISOString(); delete doc.recipient;
          await tx.put(doc); return { ok: true, reminder: await view(doc) };
        }
        const templateId = templateFor(options, event.type);
        if (!templateId) fail('NOT_ENABLED', '此类提醒模板尚未开放');
        const fingerprint = event.action === 'scheduleReminder' ? hash(event) : null;
        if (doc && (!Array.isArray(doc.receipts) || doc.receipts.length > 8)) throw Error('REMINDER_RECEIPTS_CORRUPT');
        const previous = doc && doc.receipts.find(receipt => receipt.operationId === event.operationId);
        if (previous) {
          if (previous.fingerprint !== fingerprint) fail('IDEMPOTENCY_MISMATCH', '请勿复用提醒请求标识');
          return { ok: true, reminder: await view(doc), replayed: true };
        }
        if (doc && doc.status !== 'cancelled') fail('REMINDER_EXISTS', '这一天此类提醒已有记录，请先查看状态');
        if (doc && doc.generation >= 8) fail('RATE_LIMITED', '当天重新申请次数已达上限');
        const scopes = await resolveReminderScopes(tx, { account, owner, type: event.type, businessDate: event.businessDate,
          habitIds: event.habitIds, relationIds: event.relationIds, domain, dates, now });
        const next = appointment(scopes, event.type, event.businessDate, event.slot, dates);
        if (Date.parse(next.dueAt) <= now.getTime() + 60000) fail('PREVIEW_CHANGED', '提醒时间已到，请选择下一次');
        // A late deadline can send on the following calendar day. Read both
        // possible business-date keys in the transaction before claiming quota.
        const deliveryDate = dates.today(Date.parse(next.dueAt));
        for (const candidateDate of [dates.shift(deliveryDate, -1), deliveryDate]) {
          const reserved = candidateDate === event.businessDate ? doc : await readOwn(candidateDate, event.type);
          if (reserved && reserved.status !== 'cancelled' && dates.today(Date.parse(reserved.dueAt)) === deliveryDate) {
            fail('REMINDER_EXISTS', '同一天此类提醒已有记录，请先查看状态');
          }
        }
        const selected = event.type === 'self' ? { habitIds: scopes.map(scope => scope.habitId).sort() } : { relationIds: scopes.map(scope => scope.relationId).sort() };
        const scopeFingerprint = hash({ type: event.type, businessDate: event.businessDate, ...next, scopes });
        if (event.action === 'previewReminder') return { ok: true, preview: { type: event.type, businessDate: event.businessDate,
          ...next, ...selected, items: scopes.map(publicItem), sourceRevision: account.revision, scopeFingerprint,
          generation: doc ? doc.generation : 0, operationId: crypto.randomBytes(24).toString('hex'), templateId } };
        if ((doc ? doc.generation : 0) !== event.generation) fail('CONFLICT', '提醒状态已变化，请重新预览');
        if (account.revision !== event.sourceRevision || scopeFingerprint !== event.scopeFingerprint || next.dueAt !== event.dueAt) {
          fail('PREVIEW_CHANGED', '事项、约定或时间已变化，请重新预览并授权');
        }
        const created = { _id: reminderId(owner, account.epoch, event.businessDate, event.type), schemaVersion: 2,
          owner, ownerEpoch: account.epoch, type: event.type, businessDate: event.businessDate, ...next, ...selected, scopes, scopeFingerprint,
          generation: event.generation + 1, templateId, status: 'pending', acceptedReportedAt: now.toISOString(), claimedAt: null,
          updatedAt: now.toISOString(), expiresAt: new Date(Date.parse(next.dueAt) + 14 * 86400000).toISOString(),
          receipts: [...(doc ? doc.receipts : []), { operationId: event.operationId, fingerprint }] };
        created.recipient = codec.seal(callerIdentity(identity).OPENID, recipientAAD(created));
        await tx.put(created); return { ok: true, reminder: await view(created), replayed: false };
      });
    } catch (err) {
      return err instanceof ApiError ? { ok: false, code: err.code, message: err.message } : { ok: false, code: 'SERVICE_UNAVAILABLE', message: '提醒服务暂不可用，请稍后重试' };
    }
  };
}
async function eligibleNextReminder(tx, doc, { domain, dates, options, now }) {
  nextView(doc);
  const account = await tx.account();
  if (!account || account.cleanupPending || account.epoch !== doc.ownerEpoch || doc.templateId !== templateFor(options, doc.type) ||
    !Number.isFinite(Date.parse(doc.dueAt)) || Date.parse(doc.dueAt) > now.getTime() || now.getTime() - Date.parse(doc.dueAt) > 900000) return [];
  domain.validateState(account.state);
  // Unlike self reminders, a 23:50 deadline may legitimately send at 00:05.
  if (doc.businessDate < dates.shift(dates.today(now.getTime()), -1) || doc.businessDate > dates.today(now.getTime())) return [];
  const scopes = await resolveReminderScopes(tx, { account, owner: doc.owner, type: doc.type, businessDate: doc.businessDate,
    habitIds: doc.habitIds, relationIds: doc.relationIds, domain, dates, now });
  return scopes.filter(scope => {
    const previous = doc.scopes.find(saved => (saved.relationId || saved.habitId) === (scope.relationId || scope.habitId));
    if (!previous || scope.planRevision !== previous.planRevision) return false;
    if (doc.type === 'self') return doc.businessDate === dates.today(now.getTime());
    return scope.subjectOwner === previous.subjectOwner && scope.subjectEpoch === previous.subjectEpoch && scope.revision === previous.revision &&
      scope.deadline === previous.deadline && now.getTime() >= Date.parse(doc.businessDate + 'T' + scope.deadline + ':00+08:00') + 15 * 60000;
  });
}
module.exports = { TYPES, TIME, templateFor, nextView, resolveReminderScopes, appointment, createNextReminderApi, eligibleNextReminder };
