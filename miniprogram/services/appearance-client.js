'use strict';

// 外观主题的独立云协议客户端。只使用 getAppearance / setAppearance 两个动作，
// 不触碰分享、提醒与 AI 门控；结果不明时冻结完全相同的请求等待核对，绝不生成第二份写意图。
const { createCloudTransport } = require('./cloud-transport');
const resources = require('../config/cloud-resources');
const THEME_VALUES = ['mist', 'paper'];

function validAppearance(value) {
  if (!value || !Number.isSafeInteger(value.revision) || value.revision < 0 ||
    !THEME_VALUES.includes(value.theme)) throw Error('主题响应格式无效');
  return { revision: value.revision, theme: value.theme };
}

function createAppearanceClient(wxApi, cloudConfig, config, session, options = {}) {
  const factory = options.transportFactory || createCloudTransport, clock = options.clock || Date.now;
  let transport = null, cache = null, confirmed = null, inFlight = null, serial = 0;
  let frozen = null; // { key, payload, context }：已发出但结果未确认的保存请求，只允许原样重放
  let lastSaveError = '';
  let activeKey = '', generation = 0, sending = null, preparing = null;
  const enabled = () => config.enabled === true && cloudConfig.enabled === true && cloudConfig.functionName === resources.apiFunction;

  function syncContext() {
    const s = session && session.status();
    const key = s && s.accountId && s.epoch
      ? (options.contextKey ? options.contextKey() : s.accountId + ':' + s.epoch + (s.generation === undefined ? '' : ':' + s.generation)) : '';
    if (key !== activeKey) {
      activeKey = key; generation += 1;
      cache = null; confirmed = null; inFlight = null; frozen = null; sending = null; preparing = null; lastSaveError = '';
    }
    return { status: s, key, generation };
  }
  function changed() { const err = Error('账户数据已变化，已忽略旧页面的结果'); err.code = 'EPOCH_CHANGED'; return err; }
  function assertCurrent(ticket) {
    const now = syncContext();
    if (now.key !== ticket.key || now.generation !== ticket.generation) throw changed();
  }
  function context() {
    const current = syncContext(), s = current.status;
    if (!s || !s.ready || !s.accountId || !s.epoch) throw Error('云端记录尚未读取，请稍后重试');
    return current;
  }
  function accept(key, value) {
    // 强制重读可失效缓存命中，不能忘掉同一账户已经确认的较高版本。
    if (!confirmed || value.revision >= confirmed.revision) confirmed = value;
    cache = { key, value: confirmed };
    return { ...cache.value };
  }
  async function timeout(work) {
    let timer;
    try {
      return await Promise.race([work, new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error('请求超时，未自动重试。请保留当前页面后重试')), options.timeoutMs || 15000);
      })]);
    } finally { clearTimeout(timer); }
  }
  // 保存前置检查：离线、主会话 pending/conflict、删除中、无可信上下文都拒绝。
  // 这些错误发生在发出任何请求之前，不产生云副作用。
  function precondition() {
    if (!enabled()) throw Error('外观主题功能尚未开放');
    const before = context();
    if (before.status.deletionPending) throw Error('删除尚未确认，请先到数据管理完成删除');
    if (before.status.networkOffline || before.status.phase === 'offline') throw Error('连接网络后可保存主题');
    if (before.status.pending || before.status.conflict) throw Error('请先完成云端同步，再保存主题');
    return before;
  }
  async function request(payload, ticket) {
    const before = precondition();
    assertCurrent(ticket);
    if (!transport) transport = factory(wxApi, { ...cloudConfig, functionName: resources.featuresFunction });
    let result;
    try { result = await timeout(transport({ ...payload, epoch: before.status.epoch })); }
    catch (err) { assertCurrent(ticket); throw err; }
    assertCurrent(ticket);
    if (!result || result.ok !== true) {
      const error = Error(result && result.message || '主题未保存，请重试');
      error.code = result && result.code;
      throw error;
    }
    return result;
  }

  // 读取：同一上下文共享一次在途请求；不落本机偏好，不阻塞习惯读取。
  async function read(force = false) {
    if (!enabled()) return null;
    const ticket = context(), { key } = ticket;
    if (!force && cache && cache.key === key) return { ...cache.value };
    if (inFlight && inFlight.key === key) return inFlight.work;
    const flight = { ...ticket };
    flight.work = request({ action: 'getAppearance' }, ticket).then(result => {
      assertCurrent(ticket);
      return accept(key, validAppearance(result.appearance));
    }).finally(() => { if (inFlight === flight) inFlight = null; });
    inFlight = flight;
    return flight.work;
  }

  function status() {
    const { key } = syncContext();
    return {
      enabled: enabled(),
      contextKey: key,
      cached: cache && cache.key === key ? { ...cache.value } : null,
      frozen: frozen && frozen.key === key ? frozen.payload.theme : null,
      lastSaveError
    };
  }

  // 保存前置：离线、主会话 pending/conflict、无可信上下文或无合法 revision 时拒绝。
  // 只使用当前上下文的合法 revision；尚无已读版本时先读取，仍失败就不冻结、不发写请求。
  async function save(theme) {
    if (!THEME_VALUES.includes(theme)) throw Error('主题参数无效');
    const ticket = precondition();
    if (frozen) return replay();
    if (preparing) return preparing.work;
    const preparation = { ...ticket };
    preparation.work = read().then(current => {
      assertCurrent(ticket);
      precondition();
      const payload = { action: 'setAppearance', operationId: 'theme-' + clock().toString(36) + '-' + (++serial),
        expectedRevision: current.revision, theme };
      frozen = { ...ticket, payload };
      return send();
    }).finally(() => { if (preparing === preparation) preparing = null; });
    preparing = preparation;
    return preparation.work;
  }

  function send() {
    const request_ = frozen;
    if (sending && sending.request === request_) return sending.work;
    const flight = { request: request_ };
    flight.work = sendRequest(request_).finally(() => { if (sending === flight) sending = null; });
    sending = flight;
    return flight.work;
  }
  async function sendRequest(request_) {
    try {
      const result = await request({ ...request_.payload }, request_);
      assertCurrent(request_);
      if (frozen !== request_) throw changed();
      const value = accept(request_.key, validAppearance(result.appearance));
      frozen = null; lastSaveError = '';
      return { ...value, replayed: result.replayed === true };
    } catch (err) {
      // 旧请求的失败也不能解除新上下文正在等待确认的意图。
      if (frozen !== request_) throw err;
      if (err.code === 'CONFLICT' || err.code === 'IDEMPOTENCY_MISMATCH' || err.code === 'NOT_ENABLED' ||
        err.code === 'INVALID_REQUEST' || err.code === 'DELETE_PENDING' || err.code === 'ACCOUNT_REQUIRED' || err.code === 'EPOCH_CHANGED') {
        // 已知拒绝不会产生写入副作用，结束本次冻结，按原因提示。
        // 冲突后缓存版本已不可信，下一次明确保存前必须重新读取当前值。
        if (err.code === 'CONFLICT' || err.code === 'EPOCH_CHANGED') cache = null;
        frozen = null; lastSaveError = err.message;
        throw err;
      }
      // 网络或服务结果不明：保留冻结请求，只允许原样核对；不因读到某个颜色就认定旧写结束。
      lastSaveError = err.message || '主题保存结果待核对';
      throw err;
    }
  }

  // 只重放完全相同的 operationId 与 payload，服务器幂等收据确认后才解除不确定状态。
  function replay() {
    syncContext();
    if (!frozen) return Promise.resolve(cache ? { ...cache.value, replayed: true } : null);
    return send();
  }

  function forget() { frozen = null; lastSaveError = ''; }

  return {
    status, read, save, replay, forget,
    configured: enabled,
    cached(force) { if (force) return read(true).catch(() => null); return status().cached; },
    contextKey() { return context().key; },
    invalidate() { cache = null; inFlight = null; }
  };
}

function appearanceClient() {
  const app = getApp();
  if (!app.appearanceClient) {
    app.appearanceClient = createAppearanceClient(wx, require('../config/cloud'), require('../config/appearance'), app.cloudSession);
  }
  return app.appearanceClient;
}

module.exports = { createAppearanceClient, appearanceClient, validAppearance };
