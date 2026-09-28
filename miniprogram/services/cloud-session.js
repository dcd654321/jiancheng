'use strict';

const domain = require('../core/habits');
const dates = require('../core/date');
const { createCloudTransport } = require('./cloud-transport');
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
  let foreground = null;
  let recovery = null;
  let networkOffline = false;
  let lastError = '';
  let lastSyncedAt = '';
  let lastAttemptAt = 0;
  let transport = null;
  let notificationQueued = false;
  const listeners = new Set();
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

  function invoke(event) {
    if (!transport) transport = transportFactory(wxApi, config);
    return transport(event);
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
      ready: !!snapshot && phase === 'ready',
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
    snapshot = clone(value);
    phase = 'ready';
    lastError = '';
    lastSyncedAt = new Date(now()).toISOString();
    notify();
  }

  function ensureReadable() {
    if (!snapshot || phase !== 'ready') throw Error(lastError || '云端记录尚未读取，请联网重试');
  }

  async function pull() {
    lastAttemptAt = now();
    try {
      const result = await invoke({ action: 'pull' });
      if (!result || result.ok !== true) {
        const error = Error(result && result.message || '云端记录暂不可用，请重试');
        error.code = result && result.code;
        throw error;
      }
      acceptSnapshot(result);
      return status();
    } catch (error) {
      phase = error.code === 'DELETE_PENDING' ? 'deleting' : 'offline';
      lastError = error.message || '云端记录暂不可用，请重试';
      notify();
      throw error;
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
        } else phase = snapshot ? 'ready' : 'offline';
        lastError = result.message || '云端未接受本次操作，请刷新后重试';
      }
      notify();
      throw Error(lastError);
    }
    try { validateReceipt(result, event); }
    catch (error) {
      phase = 'uncertain';
      lastError = error.message;
      notify();
      throw error;
    }
    pendingEvent = null;
    acceptSnapshot(result);
    return event.action === 'purge' ? { state: clone(snapshot.state) } : clone(snapshot.state);
  }

  function makeEvent(action, command, confirmation) {
    ensureReadable();
    if (busy || pendingEvent) throw Error('上一操作尚未确认，请先重试确认');
    if (networkOffline) throw Error('当前无网络，云端保存不可用');
    const operationDate = dates.today(now());
    if (command) {
      if (RECORD_TYPES.includes(command.type) && command.date !== operationDate) throw Error('只能记录今天的打卡');
      domain.reduce(snapshot.state, command, operationDate);
    }
    const operationId = newId();
    if (!EPOCH.test(operationId)) throw Error('操作标识无效');
    return { action, operationId, epoch: snapshot.epoch, expectedRevision: snapshot.revision,
      operationDate, ...(command ? { command: clone(command) } : { confirmation }) };
  }

  async function start() {
    if (!configured) {
      phase = 'offline';
      lastError = '云环境尚未配置';
      notify();
      return status();
    }
    if (pendingEvent) return retry();
    if (!snapshot) { phase = 'loading'; notify(); }
    return exclusive(pull);
  }

  function retry() {
    if (!pendingEvent) return refresh();
    return exclusive(async () => { await sendPending(); return status(); });
  }

  function refresh() {
    if (pendingEvent) return retry();
    if (!configured) return start();
    return exclusive(pull);
  }

  async function foregroundWork(force) {
    if (activeWork) await activeWork;
    if (pendingEvent) return retry();
    if (!snapshot || phase !== 'ready' || force || now() - lastAttemptAt >= 30000) return refresh();
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
      }
      notify();
    },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    read() { ensureReadable(); return clone(snapshot.state); },
    dispatch,
    purge
  };
}

module.exports = { createCloudSession };
