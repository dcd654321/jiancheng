const { createCloudTransport } = require('./cloud-transport');
const resources = require('../config/cloud-resources');
const { present } = require('../core/share-presentation');
const dates = require('../core/date');
const clone = value => JSON.parse(JSON.stringify(value));
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function createFeaturesClient(wxApi, cloudConfig, config, session, options = {}) {
  const factory = options.transportFactory || createCloudTransport, clock = options.clock || Date.now;
  let privateTransport, publicTransport, cache = null, inFlight = null, serial = 0;
  const drafts = new Map();
  const configured = () => config.enabled === true && cloudConfig.enabled === true && cloudConfig.functionName === resources.apiFunction;
  const publicConfigured = () => configured() && config.publicShares === true;
  function context() {
    const s = session && session.status();
    if (!s || !s.ready || !s.accountId || !s.epoch) throw Error('云端记录尚未读取，请稍后重试');
    return { status: s, key: s.accountId + ':' + s.epoch };
  }
  async function timeout(work) {
    let timer;
    try { return await Promise.race([work, new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error('请求超时，未自动重试。请保留当前页面后重试')), options.timeoutMs || 15000);
    })]); } finally { clearTimeout(timer); }
  }
  async function request(payload, expectedContext) {
    if (!configured()) throw Error('分享与置顶功能尚未开放');
    const before = context();
    if (expectedContext && before.key !== expectedContext) throw Error('账户数据已变化，请重新打开页面');
    if (before.status.deletionPending) throw Error('删除尚未确认，请先到数据管理完成删除');
    if (before.status.networkOffline || before.status.phase === 'offline') throw Error('此操作需要联网，当前习惯记录不受影响');
    if (before.status.pending || before.status.conflict) throw Error('请先完成数据同步，再使用分享或置顶');
    if (!privateTransport) privateTransport = factory(wxApi, { ...cloudConfig, functionName: resources.featuresFunction });
    const result = await timeout(privateTransport({ ...payload, epoch: before.status.epoch }));
    if (context().key !== before.key) throw Error('账户数据已变化，已忽略旧页面的结果');
    if (!result || result.ok !== true) {
      const error = Error(result && result.message || '操作未完成，请重试'); error.code = result && result.code; throw error;
    }
    return result;
  }
  function validatePreferences(value) {
    if (!value || !Number.isSafeInteger(value.revision) || value.revision < 0 ||
      (value.pinnedHabitId !== null && (typeof value.pinnedHabitId !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(value.pinnedHabitId))) ||
      ![null,'08:00','12:30','20:30'].includes(value.reminderSlot)) throw Error('偏好响应格式无效');
    return { revision: value.revision, pinnedHabitId: value.pinnedHabitId, reminderSlot: value.reminderSlot };
  }
  function share(value) {
    if (!value || !hex(value.shareId) || !['active','revoked','expired'].includes(value.status) ||
      typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt)) ||
      typeof value.expiresAt !== 'string' || !Number.isFinite(Date.parse(value.expiresAt))) throw Error('分享响应格式无效');
    present(value.publicSnapshot);
    return { shareId: value.shareId, status: value.status, createdAt: value.createdAt, expiresAt: value.expiresAt, publicSnapshot: clone(value.publicSnapshot) };
  }
  async function preferences(force = false) {
    if (!configured()) return null;
    const { key } = context();
    if (!force && cache && cache.key === key) return clone(cache.value);
    if (inFlight && inFlight.key === key) return inFlight.work;
    const flight = { key };
    flight.work = request({ action: 'getPreferences' }, key).then(result => {
      const value = validatePreferences(result.preferences); cache = { key, value }; return clone(value);
    }).finally(() => { if (inFlight === flight) inFlight = null; });
    inFlight = flight; return flight.work;
  }
  function reminder(value) {
    if (!value || !['pending','claimed','sent','cancelled','failed','unknown'].includes(value.status) ||
      !['08:00','12:30','20:30'].includes(value.slot) || !Number.isInteger(value.generation) || value.generation<1 || value.generation>8 ||
      typeof value.dueAt!=='string' || !Number.isFinite(Date.parse(value.dueAt))) throw Error('提醒响应格式无效');
    dates.assertDate(value.businessDate);
    return {businessDate:value.businessDate,slot:value.slot,dueAt:value.dueAt,generation:value.generation,status:value.status};
  }
  const remindersEnabled=()=>configured() && (options.remindersConfig || require('../config/reminders')).enabled === true;
  const reminderRequest=payload=>{
    if(!remindersEnabled())throw Error('提醒功能尚未开放');return request(payload);
  };
  return {
    status: () => ({ enabled: configured(), publicShares: publicConfigured(), timeline: publicConfigured() && config.timeline === true, reminders:remindersEnabled() }),
    contextKey: () => context().key,
    preferences,
    cachedPreferences() { try { return cache && cache.key === context().key ? clone(cache.value) : null; } catch (_) { return null; } },
    async setPinned(id) {
      if (!configured()) throw Error('分享与置顶功能尚未开放');
      const key = context().key, value = await preferences(true);
      const result = await request({ action: 'setPreferences', operationId: 'pref-' + clock().toString(36) + '-' + (++serial),
        expectedRevision: value.revision, patch: { pinnedHabitId: id } }, key);
      cache = { key, value: validatePreferences(result.preferences) }; return clone(cache.value);
    },
    async preview(input) {
      const key = context().key, selected = clone(input);
      const result = await request({ ...selected, action: 'previewShare' }, key);
      present(result.publicSnapshot);
      if (!hex(result.requestId) || !Number.isSafeInteger(result.sourceRevision) || result.sourceRevision < 0) throw Error('分享预览响应无效');
      dates.assertDate(result.requestDate);
      return { context: key, publicSnapshot: clone(result.publicSnapshot), request: { ...selected, action: 'createShare',
        requestId: result.requestId, requestDate: result.requestDate, sourceRevision: result.sourceRevision } };
    },
    async create(preview) {
      if (!preview || !preview.request || preview.request.action !== 'createShare') throw Error('请先预览公开内容');
      const result = await request(clone(preview.request), preview.context);
      return share(result.share);
    },
    async list(cursor) {
      const result = await request({ action: 'listMyShares', ...(cursor ? { cursor } : {}) });
      if (!Array.isArray(result.items) || result.items.length > 20 || (result.nextCursor !== null && !hex(result.nextCursor))) throw Error('分享列表响应无效');
      return { items: result.items.map(share), nextCursor: result.nextCursor };
    },
    async ownShare(shareId) {
      const value = share((await request({ action: 'getMyShare', shareId })).share);
      if (value.shareId !== shareId) throw Error('分享响应与请求不符'); return value;
    },
    async revoke(shareId) { return request({ action: 'revokeShare', shareId }); },
    async remove(shareId) { return request({ action: 'deleteShare', shareId }); },
    async reminderPreview(slot) {
      const key=context().key,result=await reminderRequest({action:'previewReminder',slot}),p=result.preview;
      if(!p || p.slot!==slot || typeof p.templateId!=='string' || !/^[a-zA-Z0-9_-]{10,128}$/.test(p.templateId) ||
        typeof p.operationId!=='string'|| !/^[a-zA-Z0-9_-]{1,100}$/.test(p.operationId) || !Number.isSafeInteger(p.sourceRevision) ||
        !Number.isInteger(p.generation)||p.generation<0||p.generation>=8||typeof p.dueAt!=='string'||!Number.isFinite(Date.parse(p.dueAt)))throw Error('提醒预览响应无效');
      dates.assertDate(p.businessDate);return {...clone(p),context:key};
    },
    async scheduleReminder(preview) {
      if(!remindersEnabled())throw Error('提醒功能尚未开放');
      const {context:expected,templateId,...fields}=preview;
      return reminder((await request({action:'scheduleReminder',...fields,subscriptionResult:'accept'},expected)).reminder);
    },
    async reminders() {
      const result=await reminderRequest({action:'getReminders'});
      if(!Array.isArray(result.items)||result.items.length>8)throw Error('提醒列表响应无效');return result.items.map(reminder);
    },
    async cancelReminder(item) {return reminder((await reminderRequest({action:'cancelReminder',businessDate:item.businessDate,generation:item.generation})).reminder);},
    async publicShare(shareId) {
      if (!publicConfigured()) throw Error('公开分享暂未开放');
      if (!hex(shareId)) throw Error('这份分享暂不可用或已失效');
      if (!publicTransport) publicTransport = factory(wxApi, { ...cloudConfig, functionName: resources.publicShareFunction });
      // This is only a read of the selected public snapshot. No personal account pull/consent write.
      const result = await timeout(publicTransport({ action: 'getPublicShare', shareId }));
      if (!result || result.ok !== true) throw Error('这份分享暂不可用或已失效');
      if (typeof result.expiresAt !== 'string' || !Number.isFinite(Date.parse(result.expiresAt))) throw Error('分享响应格式无效');
      present(result.publicSnapshot); return { publicSnapshot: clone(result.publicSnapshot), expiresAt: result.expiresAt };
    },
    handoff(snapshot) {
      const view = present(snapshot); if (!view.canCopy) throw Error('这份分享不是可复制的计划');
      const key = context().key, token = 'shared-' + clock().toString(36) + '-' + (++serial);
      for (const [id, draft] of drafts) if (draft.until <= clock()) drafts.delete(id);
      if (drafts.size >= 8) drafts.delete(drafts.keys().next().value);
      drafts.set(token, { key, plan: clone(view.plan), until: clock() + 600000 }); return token;
    },
    consume(token) {
      const draft = drafts.get(token); drafts.delete(token);
      if (!draft || draft.key !== context().key || draft.until <= clock()) throw Error('分享计划已过期，请返回重新选择');
      return clone(draft.plan);
    }
  };
}
function features() {
  const app = getApp();
  if (!app.featuresClient) app.featuresClient = createFeaturesClient(wx, require('../config/cloud'), require('../config/features'), app.cloudSession);
  return app.featuresClient;
}
module.exports = { createFeaturesClient, features };
