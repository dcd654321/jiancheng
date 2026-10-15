'use strict';

const domain = require('../core/habits');
const dates = require('../core/date');
const { createCloudTransport, withTimeout, recordTiming, READ_TIMEOUT_MS } = require('./cloud-transport');
const { apiFunction } = require('../config/cloud-resources');

const clone = value => JSON.parse(JSON.stringify(value));
const ACCOUNT = /^[a-f0-9]{64}$/;
const EPOCH = /^[a-zA-Z0-9_-]{1,100}$/;
const RECORD_TYPES = ['complete', 'completeMinimum', 'undo', 'simplify', 'restore', 'note'];

/** Only confirmed cloud snapshots live in memory. No device storage or offline queue. */
function createCloudSession(wxApi, config, transportFactory = createCloudTransport, options = {}) {
  let snapshot = null;
  let pendingEvent = null;
  let phase = 'loading';
  let busy = false;
  let activeWork = null;
  let activeRead = null;
  let foreground = null;
  let recovery = null;
  let networkOffline = false;
  let lastError = '';
  let lastErrorCode = '';
  let lastSyncedAt = '';
  let lastConfirmedAt = 0;
  let lastAttemptAt = 0;
  let transport = null;
  let notificationQueued = false;
  const listeners = new Set();
  const confirmationListeners = new Set();
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const newId = typeof options.newId === 'function' ? options.newId
    : () => 'op_' + now().toString(36) + '_' + Math.random().toString(36).slice(2, 12);
  const envValid = typeof config.envId === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(config.envId)
    && !config.envId.startsWith('YOUR_');
  const sharedValid = config.mode !== 'shared' || (
    typeof config.resourceAppid === 'string' && /^wx[a-f0-9]{16}$/.test(config.resourceAppid)
    && (config.functionName === undefined || config.functionName === apiFunction)
    && config.storageNamespace === 'jiancheng_daka'
  );
  const configured = config.enabled === true && envValid && sharedValid
    && (config.mode === undefined || config.mode === 'default' || config.mode === 'shared');

  function invoke(event, request) {
    if (!transport) transport = transportFactory(wxApi, config, options);
    return transport(event, request);
  }

  function validate(value) {
    if (!value || value.ok !== true || !ACCOUNT.test(value.accountId || '') ||
      !EPOCH.test(value.epoch || '') || !Number.isSafeInteger(value.revision) || value.revision < 0) {
      throw Error('云端账户响应无效，未更新页面');
    }
    dates.assertDate(value.serverDate);
    domain.validateState(value.state);
    return value;
  }

  function notify() {
    if (notificationQueued) return;
    notificationQueued = true;
    Promise.resolve().then(() => {
      notificationQueued = false;
      listeners.forEach(listener => {
        try { listener(); } catch (_) { /* Views cannot interrupt cloud work. */ }
      });
    });
  }

  function status() {
    return {
      configured,
      connected: !!snapshot,
      ready: !!snapshot && phase === 'ready' && !networkOffline,
      // 已有本账户已确认快照但当前阶段不可写（离线/待核对）：页面可只读呈现，不创建本机快照。
      stale: !!snapshot && phase !== 'ready',
      phase,
      busy,
      networkOffline,
      accountId: snapshot ? snapshot.accountId : '',
      epoch: snapshot ? snapshot.epoch : '',
      accountLabel: snapshot ? snapshot.accountId.slice(-6) : '',
      pending: pendingEvent ? 1 : 0,
      deletionPending: (!!pendingEvent && pendingEvent.action === 'purge') || phase === 'deleting',
      count: snapshot ? snapshot.state.habits.length : 0,
      conflict: null,
      lastError,
      lastErrorCode,
      lastSyncedAt,
      lastAttemptAt
    };
  }

  async function exclusive(action) {
    if (busy) throw Error('正在处理，请稍候');
    busy = true;
    let release;
    activeWork = new Promise(resolve => { release = resolve; });
    notify();
    try { return await action(); }
    finally {
      busy = false;
      activeWork = null;
      release();
      notify();
    }
  }

  function acceptSnapshot(value) {
    validate(value);
    acceptValidatedSnapshot(value);
  }

  function acceptValidatedSnapshot(value) {
    snapshot = clone(value);
    // 请求发出后可能先收到断网通知，再收到合法的云回执。
    // 确认数据仍应接收，页面须继续只读，等待联网恢复重新读取。
    phase = networkOffline ? 'offline' : 'ready';
    lastError = networkOffline ? '当前无网络，云端记录不可用' : '';
    lastErrorCode = '';
    lastConfirmedAt = now();
    lastSyncedAt = new Date(lastConfirmedAt).toISOString();
    notify();
  }

  function ensureReadable() {
    if (!snapshot || phase !== 'ready' || networkOffline) throw Error(lastError || '云端记录尚未读取，请联网重试');
  }

  async function pull() {
    lastAttemptAt = now();
    lastErrorCode = '';
    const startedAt = now();
    const initialRead = !snapshot;
    let code = 'FAILED';
    let current = true;
    try {
      // The deadline only covers reads. Writes retain their original pending receipt.
      const result = await withTimeout(() => invoke({ action: 'pull' }, { isCurrent: () => current }),
        options.readTimeoutMs || READ_TIMEOUT_MS, options);
      if (!result || result.ok !== true) {
        const error = Error(result && result.message || '云端记录暂不可用，请重试');
        error.code = result && result.code;
        throw error;
      }
      const acceptAt = now();
      acceptSnapshot(result);
      recordTiming(options, 'state_accept', acceptAt, 'OK');
      code = 'OK';
      return status();
    } catch (error) {
      if (error.code === 'CLOUD_READ_TIMEOUT' || error.code === 'CLOUD_INIT_TIMEOUT') code = 'TIMEOUT';
      phase = error.code === 'DELETE_PENDING' ? 'deleting' : 'offline';
      lastError = error.message || '云端记录暂不可用，请重试';
      lastErrorCode = typeof error.code === 'string' && /^[A-Z_]{1,60}$/.test(error.code) ? error.code : '';
      notify();
      throw error;
    } finally {
      current = false;
      if (initialRead) recordTiming(options, 'startup_read', startedAt, code);
    }
  }

  function validateReceipt(result, event) {
    validate(result);
    if (!snapshot || result.accountId !== snapshot.accountId || result.operationId !== event.operationId ||
      result.appliedRevision !== event.expectedRevision + 1 || result.revision < result.appliedRevision ||
      (event.action === 'mutate' && result.epoch !== event.epoch) ||
      (event.action === 'purge' && result.epoch === event.epoch)) {
      throw Error('云端确认与本次操作不匹配，结果未确认');
    }
  }

  async function sendPending() {
    const event = pendingEvent;
    if (!event) return pull();
    lastAttemptAt = now();
    let result;
    try { result = await invoke(event); }
    catch (_) {
      phase = 'uncertain';
      lastError = '云端结果未确认，请联网重试确认；不要重复提交新操作';
      notify();
      throw Error(lastError);
    }
    if (!result || typeof result.ok !== 'boolean') {
      phase = 'uncertain';
      lastError = '云端响应无效，请重试确认';
      notify();
      throw Error(lastError);
    }
    if (!result.ok) {
      if (result.code === 'SERVICE_UNAVAILABLE' || result.code === 'DELETE_PENDING') {
        phase = result.code === 'DELETE_PENDING' ? 'deleting' : 'uncertain';
        lastError = result.message || '云端结果未确认，请重试';
      } else {
        pendingEvent = null;
        if (result.snapshot) {
          try { acceptSnapshot({ ok: true, ...result.snapshot }); }
          catch (_) { phase = 'offline'; }
        } else phase = snapshot && !networkOffline ? 'ready' : 'offline';
        lastError = event.command && event.command.type === 'deleteHabit'
          && ['INVALID_REQUEST', 'INVALID_COMMAND'].includes(result.code) && /不支持.*操作/.test(result.message || '')
          ? '删除功能暂不可用，请稍后重试。' : result.message || '云端未接受本次操作，请刷新后重试';
      }
      notify();
      const error = Error(lastError);
      if (typeof result.code === 'string' && /^[A-Z_]{1,60}$/.test(result.code)) error.code = result.code;
      throw error;
    }
    try { validateReceipt(result, event); }
    catch (error) {
      phase = 'uncertain';
      lastError = error.message;
      notify();
      throw error;
    }
    pendingEvent = null;
    acceptValidatedSnapshot(result);
    // 只在账户/操作/版本均匹配的合法回执之后通知，包括原请求的重试回执。
    const confirmation = { accountId: result.accountId, epoch: event.epoch, operationId: event.operationId,
      command: event.command ? clone(event.command) : null };
    confirmationListeners.forEach(listener => {
      try { listener(clone(confirmation)); } catch (_) { /* Views cannot interrupt acknowledged cloud work. */ }
    });
    return event.action === 'purge' ? { state: clone(snapshot.state) } : clone(snapshot.state);
  }

  function makeEvent(action, command, confirmation) {
    ensureReadable();
    if (busy || pendingEvent) throw Error('上一操作尚未确认，请先重试确认');
    if (networkOffline) throw Error('现在无法联网，记录没有丢失。联网后重试');
    const operationDate = dates.today(now());
    if (command) {
      if (RECORD_TYPES.includes(command.type) && command.date !== operationDate) throw Error('只能记录今天的打卡');
      domain.reduce(snapshot.state, command, operationDate);
    }
    const operationId = newId();
    if (!EPOCH.test(operationId)) throw Error('操作标识无效');
    let sessionId;
    if (command && snapshot.capabilities && snapshot.capabilities.monitorSessionMetadata === true && typeof options.sessionId === 'function') {
      try { sessionId = options.sessionId(); } catch (_) { /* Optional telemetry must not prevent a business intent. */ }
    }
    return { action, operationId, epoch: snapshot.epoch, expectedRevision: snapshot.revision,
      operationDate, ...(command ? { command: clone(command) } : { confirmation }),
      ...(typeof sessionId === 'string' && EPOCH.test(sessionId) ? { sessionId } : {}) };
  }

  async function start() {
    if (!configured) {
      phase = 'offline';
      lastError = '云环境尚未配置';
      lastErrorCode = '';
      notify();
      return status();
    }
    if (pendingEvent) return retry();
    return readOnce();
  }

  function readOnce() {
    if (activeRead) return activeRead;
    if (!snapshot && !busy) { phase = 'loading'; lastError = ''; lastErrorCode = ''; }
    const work = exclusive(pull);
    activeRead = work;
    const clear = () => { if (activeRead === work) activeRead = null; };
    work.then(clear, clear);
    return work;
  }

  function retry() {
    if (!pendingEvent) return refresh();
    return exclusive(async () => { await sendPending(); return status(); });
  }

  function refresh() {
    if (pendingEvent) return retry();
    if (!configured) return start();
    return readOnce();
  }

  async function foregroundWork(force) {
    if (activeWork) await activeWork;
    if (pendingEvent) return retry();
    if (!snapshot || phase !== 'ready' || force || now() - lastConfirmedAt >= 30000) return refresh();
    return status();
  }

  function onForeground(force = false) {
    if (!foreground) foreground = foregroundWork(force).finally(() => { foreground = null; });
    return foreground;
  }

  function recoverConnection() {
    if (!recovery) recovery = Promise.resolve().then(async () => {
      while (foreground || activeWork) await Promise.all([foreground, activeWork].filter(Boolean).map(work => work.catch(() => {})));
      return onForeground(true);
    }).finally(() => { recovery = null; });
    return recovery;
  }

  function dispatch(command) {
    command = clone(command);
    if (command.type === 'simplify') command.target = Number(command.target);
    const event = makeEvent('mutate', command);
    pendingEvent = event;
    return exclusive(sendPending);
  }

  async function purge(confirmation) {
    if (confirmation !== 'DELETE_MY_DATA') throw Error('删除数据需要明确确认');
    const event = makeEvent('purge', null, confirmation);
    pendingEvent = event;
    return exclusive(sendPending);
  }

  return {
    status,
    start,
    refresh,
    retry,
    onForeground,
    recoverConnection,
    setNetworkAvailable(available) {
      networkOffline = available === false;
      if (networkOffline) {
        phase = pendingEvent ? 'uncertain' : 'offline';
        lastError = pendingEvent ? '云端结果未确认，联网后重试' : '当前无网络，云端记录不可用';
        lastErrorCode = '';
      }
      notify();
    },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    subscribeConfirmed(listener) { confirmationListeners.add(listener); return () => confirmationListeners.delete(listener); },
    read() { ensureReadable(); return clone(snapshot.state); },
    // 只读回退：仅在网络失败（非写入待核对、非删除中）时返回确认过的快照，
    // 用于刷新失败后的只读呈现；不落磁盘、不构成离线写队列。
    staleRead() { return snapshot && phase === 'offline' ? clone(snapshot.state) : null; },
    dispatch,
    purge
  };
}

module.exports = { createCloudSession };
