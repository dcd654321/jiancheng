const { createCloudTransport } = require('./cloud-transport');
const resources = require('../config/cloud-resources');
const clone = value => JSON.parse(JSON.stringify(value));
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
function createSupervisionClient(wxApi, cloudConfig, config, session, options = {}) {
  let transport, serial = 0;
  const attempts = new Map(), clock = options.clock || Date.now;
  const configured = () => config.enabled === true && cloudConfig.enabled === true && cloudConfig.functionName === resources.apiFunction;
  function context() {
    const s = session && session.status();
    if (!s || !s.ready || !s.accountId || !s.epoch || s.pending || s.deletionPending) throw Error('请先恢复云端记录，再使用好友监督');
    return { key: s.accountId + ':' + s.epoch, epoch: s.epoch };
  }
  async function request(payload, write = false) {
    if (!configured()) throw Error('好友监督尚未开放');
    const origin = context();
    const token = origin.key + ':' + JSON.stringify(payload);
    if (write && !attempts.has(token)) attempts.set(token, 'sup-' + clock().toString(36) + '-' + (++serial));
    const event = { ...payload, epoch: origin.epoch, ...(write ? { operationId: attempts.get(token) } : {}) };
    if (!transport) transport = (options.transportFactory || createCloudTransport)(wxApi, { ...cloudConfig, functionName: resources.featuresFunction });
    let timer, result;
    try { result = await Promise.race([transport(event), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('结果尚未确认，请保留页面并重试')), options.timeoutMs || 15000); })]); }
    finally { clearTimeout(timer); }
    if (context().key !== origin.key) throw Error('账户数据已变化，已忽略旧结果');
    if (!result || result.ok !== true) {
      const err = Error(result && result.message || '操作结果尚未确认，请重试'); err.code = result && result.code;
      if (write && result && result.ok === false && !['SERVICE_UNAVAILABLE', 'UNKNOWN'].includes(result.code)) attempts.delete(token);
      throw err;
    }
    if (write) attempts.delete(token);
    return clone(result);
  }
  function invite(value) {
    if (!value || !validId(value.inviteId) || !value.habit || typeof value.habit.title !== 'string' || !value.rules ||
      ![7, 14, 30].includes(value.rules.durationDays) || !/^\d{2}:\d{2}$/.test(value.rules.deadline) || !Number.isFinite(Date.parse(value.expiresAt))) throw Error('邀请响应无效，请刷新核对');
    return clone(value);
  }
  function relation(value) {
    if (!value || !validId(value.supervisionId) || (value.habitId !== undefined && !validId(value.habitId)) || !['subject', 'supervisor'].includes(value.role) ||
      !['active', 'scheduled', 'ended', 'expired', 'unavailable'].includes(value.status) || !Number.isSafeInteger(value.revision) || !value.rules) throw Error('监督响应无效，请刷新核对');
    return clone(value);
  }
  return {
    status: () => ({ enabled: configured() }),
    contextKey: () => context().key,
    async create(input) { return invite((await request({ action: 'createSupervisionInvite', ...input }, true)).invite); },
    async invitation(inviteId) { const result = await request({ action: 'getSupervisionInvite', inviteId }); return { ...result, invite: invite(result.invite) }; },
    async apply(inviteId, displayName) { return request({ action: 'applySupervision', inviteId, ...(displayName ? { displayName } : {}) }, true); },
    async confirm(inviteId) { return relation((await request({ action: 'confirmSupervision', inviteId }, true)).supervision); },
    async list() {
      const result = await request({ action: 'listSupervisions' });
      if (!Array.isArray(result.items) || !Array.isArray(result.invitations)) throw Error('监督列表响应无效');
      return { items: result.items.map(relation), invitations: result.invitations.map(invite) };
    },
    async detail(supervisionId) {
      const result = await request({ action: 'getSupervision', supervisionId });
      if (!Array.isArray(result.days) || result.days.length > 31) throw Error('监督记录响应无效');
      return { supervision: relation(result.supervision), days: clone(result.days), today: clone(result.today || result.supervision.today || null) };
    },
    async end(item) { return relation((await request({ action: 'endSupervision', supervisionId: item.supervisionId, expectedRevision: item.revision }, true)).supervision); },
    async update(item, patch) { return relation((await request({ action: 'updateSupervision', supervisionId: item.supervisionId, expectedRevision: item.revision, ...patch }, true)).supervision); },
    async encourage(supervisionId, date) { return request({ action: 'encourageSupervision', supervisionId, date, kind: 'encourage' }, true); }
  };
}
function supervision() {
  const app = getApp();
  return app.supervisionClient || (app.supervisionClient = createSupervisionClient(wx, require('../config/cloud'), require('../config/supervision'), app.cloudSession));
}
function statusLabel(day) { return ({ pending: '待完成', standard: '已完成', minimum: '忙时已完成', 'not-planned': '今天无需完成' })[day && day.status] || '暂无安排'; }
function sorted(items, now = new Date()) {
  const beijing = new Date(now.getTime() + 8 * 3600000);
  const hhmm = String(beijing.getUTCHours()).padStart(2, '0') + ':' + String(beijing.getUTCMinutes()).padStart(2, '0');
  return items.map(item => {
    const today = item.today || {}, overdue = item.status === 'active' && today.status === 'pending' && today.deadline <= hhmm;
    return { ...item, dayLabel: statusLabel(today), overdue, statusLabel: ({ active: '', ended: '已结束', expired: '已到期', unavailable: '已失效' })[item.status],
      order: item.status === 'scheduled' ? 3 : item.status !== 'active' ? 4 : overdue ? 0 : today.status === 'pending' ? 1 : today.status === 'not-planned' ? 3 : 2,
      statusLabel: item.status === 'scheduled' ? '明日起监督' : ({ active: '', ended: '已结束', expired: '已到期', unavailable: '已失效' })[item.status] };
  }).sort((a, b) => a.order - b.order || (a.today && a.today.deadline || '').localeCompare(b.today && b.today.deadline || ''));
}
module.exports = { createSupervisionClient, supervision, sorted, statusLabel };
