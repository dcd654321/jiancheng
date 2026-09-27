'use strict';
const crypto = require('node:crypto');
const { ApiError, fail, token, canonical } = require('./protocol');
const { authenticate } = require('./identity');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const copy = value => JSON.parse(JSON.stringify(value));
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const HEX = /^[a-f0-9]{64}$/;
const CATEGORIES = ['read', 'walk', 'study', 'tidy'];
const SLOTS = ['08:00', '12:30', '20:30'];
const CAPTIONS = ['small-steps', 'keep-going', 'busy-still-counts'];
const PUBLIC_UNAVAILABLE = { ok: false, code: 'SHARE_UNAVAILABLE', message: '这份分享暂不可用或已失效' };
function object(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Object.keys(value).some(key => !allowed.includes(key))) fail('INVALID_REQUEST', '请求字段无效');
}
function size(value, maximum = 4096) {
  const text = JSON.stringify(value);
  if (!text || Buffer.byteLength(text, 'utf8') > maximum) fail('INVALID_REQUEST', '请求过大');
}
const FIELDS = {
  getPreferences: [], setPreferences: ['operationId', 'expectedRevision', 'patch'],
  previewShare: ['kind', 'sourceHabitId', 'categoryKey', 'includeWeekdays', 'captionKey'],
  createShare: ['kind', 'sourceHabitId', 'categoryKey', 'includeWeekdays', 'captionKey', 'requestId', 'requestDate', 'sourceRevision'],
  listMyShares: ['cursor'], getMyShare: ['shareId'], revokeShare: ['shareId'], deleteShare: ['shareId']
};
function validateRequest(event, dates) {
  size(event);
  if (!event || !own(FIELDS, event.action)) fail('INVALID_REQUEST', '不支持的请求');
  object(event, ['action', 'epoch', ...FIELDS[event.action]]);
  if (!token(event.epoch)) fail('INVALID_REQUEST', '账户版本无效');
  if (event.action === 'setPreferences') {
    if (!token(event.operationId) || !Number.isSafeInteger(event.expectedRevision) || event.expectedRevision < 0) fail('INVALID_REQUEST', '偏好版本无效');
    object(event.patch, ['pinnedHabitId', 'reminderSlot']);
    if (!Object.keys(event.patch).length || (own(event.patch, 'pinnedHabitId') && event.patch.pinnedHabitId !== null && !token(event.patch.pinnedHabitId)) ||
      (own(event.patch, 'reminderSlot') && event.patch.reminderSlot !== null && !SLOTS.includes(event.patch.reminderSlot))) fail('INVALID_REQUEST', '偏好字段无效');
  }
  if (['previewShare', 'createShare'].includes(event.action)) {
    if (!['invite', 'plan', 'weekly'].includes(event.kind)) fail('INVALID_REQUEST', '分享类型无效');
    const optional = { invite: [], plan: ['sourceHabitId', 'categoryKey', 'includeWeekdays'], weekly: ['captionKey'] }[event.kind];
    if (['sourceHabitId', 'categoryKey', 'includeWeekdays', 'captionKey'].some(k => own(event, k) && !optional.includes(k))) fail('INVALID_REQUEST', '分享字段与类型不符');
    if (event.kind === 'plan' && (!token(event.sourceHabitId) || !CATEGORIES.includes(event.categoryKey) || typeof event.includeWeekdays !== 'boolean')) fail('INVALID_REQUEST', '请选择习惯和公开类别');
    if (event.kind === 'weekly' && !CAPTIONS.includes(event.captionKey)) fail('INVALID_REQUEST', '请选择预设文案');
    if (event.action === 'createShare') {
      if (!HEX.test(event.requestId || '') || !Number.isSafeInteger(event.sourceRevision) || event.sourceRevision < 0) fail('INVALID_REQUEST', '分享请求标识无效');
      try { dates.assertDate(event.requestDate); } catch (_) { fail('INVALID_REQUEST', '分享日期无效'); }
    }
  }
  if (['getMyShare', 'revokeShare', 'deleteShare'].includes(event.action) && !HEX.test(event.shareId || '')) fail('INVALID_REQUEST', '分享标识无效');
  if (event.action === 'listMyShares' && event.cursor != null && !HEX.test(event.cursor)) fail('INVALID_REQUEST', '分页标识无效');
}

function newPreferences(owner, epoch, now) {
  return { schemaVersion: 1, owner, ownerEpoch: epoch, revision: 0, pinnedHabitId: null, reminderSlot: null,
    updatedAt: now, shareIndex: [], dailyCreates: { date: '', requests: [] }, preferenceReceipts: [] };
}
function readPreferences(saved, owner, epoch, now) {
  if (!saved) return newPreferences(owner, epoch, now);
  if (saved.schemaVersion !== 1 || saved.owner !== owner || saved.ownerEpoch !== epoch || !Number.isSafeInteger(saved.revision) || saved.revision < 0 ||
    !Array.isArray(saved.shareIndex) || saved.shareIndex.length > 200 || !Array.isArray(saved.preferenceReceipts) || saved.preferenceReceipts.length > 64 ||
    !saved.dailyCreates || !Array.isArray(saved.dailyCreates.requests) || saved.dailyCreates.requests.length > 10 ||
    (saved.pinnedHabitId !== null && !token(saved.pinnedHabitId)) || (saved.reminderSlot !== null && !SLOTS.includes(saved.reminderSlot))) throw Error('PREFERENCES_CORRUPT');
  const unique = new Set();
  for (const row of saved.shareIndex) {
    if (!HEX.test(row.id || '') || unique.has(row.id) || !['active', 'revoked'].includes(row.status) ||
      !Number.isFinite(Date.parse(row.createdAt)) || !Number.isFinite(Date.parse(row.expiresAt))) throw Error('SHARE_INDEX_CORRUPT');
    unique.add(row.id);
  }
  return saved;
}
function preferenceView(p) {
  return { revision: p.revision, pinnedHabitId: p.pinnedHabitId, reminderSlot: p.reminderSlot };
}
function snapshotFor(event, account, day, domain, dates) {
  if (event.kind === 'invite') return { kind: 'invite', coverKey: 'default', templateKeys: ['read', 'walk', 'study'] };
  if (event.kind === 'plan') {
    const habit = account.state.habits.find(h => h.id === event.sourceHabitId);
    const plan = habit && domain.versionAt(habit, day);
    if (!plan || plan.status !== 'active' || !Number.isInteger(plan.minimum) || plan.minimum < 1 || plan.minimum >= plan.target) fail('PLAN_UNAVAILABLE', '请先选择进行中且设有忙时目标的习惯');
    return { kind: 'plan', categoryKey: event.categoryKey, target: plan.target, minimum: plan.minimum, unit: plan.unit,
      ...(event.includeWeekdays ? { weekdays: [...plan.weekdays] } : {}) };
  }
  const stats = domain.summary(account.state, dates.shift(day, -1), 7);
  if (!stats.done) fail('NO_PROGRESS', '过去七天还没有完成记录，先记下一步再分享');
  return { kind: 'weekly', startDate: stats.start, endDate: stats.end, planned: stats.planned, standard: stats.standard,
    minimum: stats.minimum, captionKey: event.captionKey };
}
function safeSnapshot(snapshot, domain, dates) {
  if (!snapshot) throw Error('SNAPSHOT_MISSING');
  const allowed = { invite: ['kind', 'coverKey', 'templateKeys'], plan: ['kind', 'categoryKey', 'target', 'minimum', 'unit', 'weekdays'],
    weekly: ['kind', 'startDate', 'endDate', 'planned', 'standard', 'minimum', 'captionKey'] };
  if (!own(allowed, snapshot.kind)) throw Error('SNAPSHOT_KIND');
  object(snapshot, allowed[snapshot.kind]);
  if (snapshot.kind === 'invite') {
    if (snapshot.coverKey !== 'default' || canonical(snapshot.templateKeys) !== canonical(['read', 'walk', 'study'])) throw Error('SNAPSHOT_INVITE');
  } else if (snapshot.kind === 'plan') {
    if (!CATEGORIES.includes(snapshot.categoryKey) || !Number.isInteger(snapshot.target) || !Number.isInteger(snapshot.minimum) ||
      (own(snapshot, 'weekdays') && (!Array.isArray(snapshot.weekdays) || new Set(snapshot.weekdays).size !== snapshot.weekdays.length))) throw Error('SNAPSHOT_PLAN');
    const valid = domain.validatePlan({ title: '公开计划', ...snapshot, weekdays: snapshot.weekdays || [1,2,3,4,5,6,7] });
    if (valid.minimum === null) throw Error('SNAPSHOT_MINIMUM');
  } else {
    dates.assertDate(snapshot.startDate); dates.assertDate(snapshot.endDate);
    if (dates.shift(snapshot.startDate, 6) !== snapshot.endDate || !CAPTIONS.includes(snapshot.captionKey) ||
      ['planned', 'standard', 'minimum'].some(k => !Number.isInteger(snapshot[k]) || snapshot[k] < 0 || snapshot[k] > 35) ||
      snapshot.standard + snapshot.minimum > snapshot.planned || snapshot.standard + snapshot.minimum < 1) throw Error('SNAPSHOT_STATS');
  }
  size(snapshot, 2048);
  return copy(snapshot);
}
function shareView(share, now, domain, dates) {
  if (!HEX.test(share._id || '') || !['active', 'revoked'].includes(share.status) || !Number.isFinite(Date.parse(share.expiresAt)) ||
    !Number.isFinite(Date.parse(share.createdAt))) throw Error('SHARE_CORRUPT');
  return { shareId: share._id, status: share.status === 'revoked' ? 'revoked' : Date.parse(share.expiresAt) <= now.getTime() ? 'expired' : 'active',
    createdAt: share.createdAt, expiresAt: share.expiresAt, publicSnapshot: safeSnapshot(share.publicSnapshot, domain, dates) };
}

function createFeaturesApi({ repository, domain, dates, allowedAppId, allowedSources, clock = () => new Date() }) {
  return async function handle(event, identity) {
    try {
      const owner = authenticate(identity, allowedAppId, allowedSources);
      validateRequest(event, dates);
      const now = clock(), day = dates.today(now.getTime());
      return await repository.transact(owner, async tx => {
        const account = await tx.account();
        if (!account) fail('ACCOUNT_REQUIRED', '请先进入今日页建立自己的习惯账户');
        if (account.cleanupPending) fail('DELETE_PENDING', '个人数据正在删除，请稍后重试');
        if (account.epoch !== event.epoch) fail('EPOCH_CHANGED', '账户数据已变化，请返回重新打开');
        domain.validateState(account.state);
        const p = readPreferences(await tx.preferences(), owner, account.epoch, now.toISOString());
        const persist = async () => { p.updatedAt = now.toISOString(); await tx.putPreferences(p); };
        if (event.action === 'getPreferences') return { ok: true, preferences: preferenceView(p) };
        if (event.action === 'setPreferences') {
          const fingerprint = hash(canonical(event));
          const receipt = p.preferenceReceipts.find(r => r.id === event.operationId);
          if (receipt) {
            if (receipt.fingerprint !== fingerprint) fail('IDEMPOTENCY_MISMATCH', '请勿复用请求标识');
            return { ok: true, preferences: preferenceView(p), replayed: true };
          }
          if (p.revision !== event.expectedRevision) fail('CONFLICT', '其他设备已修改偏好，请刷新后重试');
          if (event.patch.pinnedHabitId !== undefined && event.patch.pinnedHabitId !== null) {
            const habit = account.state.habits.find(h => h.id === event.patch.pinnedHabitId);
            const plan = habit && domain.versionAt(habit, day);
            if (!plan || plan.status !== 'active') fail('INVALID_REQUEST', '只能置顶自己进行中的习惯');
          }
          Object.assign(p, event.patch); p.revision++;
          p.preferenceReceipts.push({ id: event.operationId, fingerprint });
          p.preferenceReceipts = p.preferenceReceipts.slice(-64);
          await persist(); return { ok: true, preferences: preferenceView(p), replayed: false };
        }
        if (event.action === 'previewShare') {
          return { ok: true, publicSnapshot: safeSnapshot(snapshotFor(event, account, day, domain, dates), domain, dates),
            sourceRevision: account.revision, requestDate: day, requestId: crypto.randomBytes(32).toString('hex') };
        }
        if (event.action === 'createShare') {
          if (event.requestDate !== day) fail('RECONFIRM_REQUIRED', '日期已变化，请重新预览后创建分享');
          const id = hash(owner + ':' + account.epoch + ':' + event.requestId), fingerprint = hash(canonical(event));
          if (p.dailyCreates.date !== day) p.dailyCreates = { date: day, requests: [] };
          const prior = p.dailyCreates.requests.find(r => r.id === id);
          if (prior) {
            if (prior.fingerprint !== fingerprint) fail('IDEMPOTENCY_MISMATCH', '请勿复用分享请求标识');
            const existing = await tx.share(id);
            if (!existing || existing.owner !== owner || existing.ownerEpoch !== account.epoch) fail('SHARE_UNAVAILABLE', '这份分享已删除，请重新预览');
            return { ok: true, share: shareView(existing, now, domain, dates), replayed: true };
          }
          if (event.sourceRevision !== account.revision) fail('PREVIEW_CHANGED', '记录已有变化，请重新预览公开内容');
          if (p.dailyCreates.requests.length >= 10 || p.shareIndex.length >= 200 ||
            p.shareIndex.filter(r => r.status === 'active' && Date.parse(r.expiresAt) > now.getTime()).length >= 50) fail('RATE_LIMITED', '分享数量已达上限，请明天再试或整理旧分享');
          if (await tx.share(id)) fail('IDEMPOTENCY_MISMATCH', '分享请求标识已使用');
          const snapshot = safeSnapshot(snapshotFor(event, account, day, domain, dates), domain, dates);
          const share = { _id: id, schemaVersion: 1, owner, ownerEpoch: account.epoch, requestId: event.requestId,
            kind: event.kind, status: 'active', createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + 90 * 86400000).toISOString(),
            revokedAt: null, sourceRevision: account.revision, publicSnapshot: snapshot };
          await tx.putShare(share);
          p.shareIndex.unshift({ id, createdAt: share.createdAt, expiresAt: share.expiresAt, status: 'active' });
          p.dailyCreates.requests.push({ id, fingerprint }); await persist();
          return { ok: true, share: shareView(share, now, domain, dates), replayed: false };
        }
        if (event.action === 'listMyShares') {
          const position = event.cursor == null ? -1 : p.shareIndex.findIndex(row => row.id === event.cursor);
          if (event.cursor != null && position < 0) fail('CURSOR_EXPIRED', '列表已变化，请从头刷新');
          const selected = p.shareIndex.slice(position + 1, position + 21), items = [];
          for (const row of selected) {
            const s = await tx.share(row.id);
            if (!s || s.owner !== owner || s.ownerEpoch !== account.epoch) throw Error('SHARE_INDEX_MISMATCH');
            items.push(shareView(s, now, domain, dates));
          }
          return { ok: true, items, nextCursor: position + 1 + selected.length < p.shareIndex.length ? selected[selected.length - 1].id : null };
        }
        const share = await tx.share(event.shareId);
        if (!share || share.owner !== owner || share.ownerEpoch !== account.epoch) fail('SHARE_UNAVAILABLE', '未找到可管理的分享');
        if (event.action === 'getMyShare') return { ok: true, share: shareView(share, now, domain, dates) };
        const row = p.shareIndex.find(r => r.id === share._id);
        if (!row) throw Error('SHARE_INDEX_MISMATCH');
        if (event.action === 'revokeShare') {
          share.status = 'revoked'; share.revokedAt = share.revokedAt || now.toISOString(); row.status = 'revoked';
          await tx.putShare(share); await persist();
          return { ok: true, share: shareView(share, now, domain, dates) };
        }
        await tx.removeShare(share._id); p.shareIndex = p.shareIndex.filter(r => r.id !== share._id); await persist();
        return { ok: true };
      });
    } catch (err) {
      return err instanceof ApiError ? { ok: false, code: err.code, message: err.message }
        : { ok: false, code: 'SERVICE_UNAVAILABLE', message: '服务暂不可用，请保留当前页面后重试' };
    }
  };
}

function createPublicShareApi({ repository, domain, dates, clock = () => new Date() }) {
  return async function handle(event) {
    try {
      object(event, ['action', 'shareId']); size(event, 256);
      if (event.action !== 'getPublicShare' || !HEX.test(event.shareId || '')) return { ...PUBLIC_UNAVAILABLE };
      const now = clock(), share = await repository.share(event.shareId);
      if (!share || share.schemaVersion !== 1 || share._id !== event.shareId || share.status !== 'active' ||
        !HEX.test(share.owner || '') || !token(share.ownerEpoch) || !Number.isFinite(Date.parse(share.expiresAt)) || Date.parse(share.expiresAt) <= now.getTime()) return { ...PUBLIC_UNAVAILABLE };
      const account = await repository.account(share.owner);
      if (!account || account.cleanupPending || account.epoch !== share.ownerEpoch) return { ...PUBLIC_UNAVAILABLE };
      return { ok: true, publicSnapshot: safeSnapshot(share.publicSnapshot, domain, dates), expiresAt: share.expiresAt };
    } catch (_) { return { ...PUBLIC_UNAVAILABLE }; }
  };
}
module.exports = { createFeaturesApi, createPublicShareApi, safeSnapshot, CATEGORIES, SLOTS, CAPTIONS, PUBLIC_UNAVAILABLE };
