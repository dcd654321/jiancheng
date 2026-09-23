'use strict';

const { createCloudTransport } = require('./cloud-transport');
const { apiFunction } = require('../config/cloud-resources');
const { createCloudBinding, cloudStorageScope } = require('./cloud-binding');
const { createSyncEngine, PREFIX } = require('./sync-engine');
const dates = require('../core/date');
const RECORD_TYPES = ['complete', 'undo', 'simplify', 'restore', 'note'];

function createCloudSession(wxApi, config, transportFactory = createCloudTransport, options = {}) {
  let engine = null;
  let busy = false;
  let background = null;
  let foreground = null;
  let recovery = null;
  let activeWork = null;
  let networkOffline = false;
  const listeners = new Set();
  let notificationQueued = false;
  let accountId = '';
  let transport = null;
  let phase = 'needsConsent';
  let lastAttemptAt = 0;
  let lastError = '';
  const envValid = typeof config.envId === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(config.envId)
    && !config.envId.startsWith('YOUR_');
  const sharedValid = config.mode !== 'shared' || (
    typeof config.resourceAppid === 'string' && /^wx[a-f0-9]{16}$/.test(config.resourceAppid)
    && (config.functionName === undefined || config.functionName === apiFunction)
    && config.storageNamespace === 'jiancheng_daka'
  );
  const configured = config.enabled === true && envValid && sharedValid
    && (config.mode === undefined || config.mode === 'default' || config.mode === 'shared');
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const scope = cloudStorageScope(envValid ? config.envId : '__invalid__', config.storageNamespace);
  const storage = {
    getStorageSync: key => wxApi.getStorageSync(scope + key),
    setStorageSync: (key, value) => wxApi.setStorageSync(scope + key, value),
    removeStorageSync: key => wxApi.removeStorageSync(scope + key)
  };
  const binding = envValid ? createCloudBinding(wxApi, config.envId, config.storageNamespace) : {
    consented: () => false,
    accept() { throw Error('云环境尚未配置，本机记录不受影响'); },
    accountId: () => '',
    bind() { throw Error('云环境尚未配置，本机记录不受影响'); }
  };

  function invoke(event) {
    if (!transport) transport = transportFactory(wxApi, { ...config, consent: true });
    return transport(event);
  }

  function status() {
    const current = engine ? engine.read() : null;
    return {
      configured,
      consented: binding.consented(),
      connected: !!engine,
      ready: !!engine,
      phase,
      busy,
      networkOffline,
      accountId,
      epoch: current ? current.epoch : '',
      accountLabel: accountId ? accountId.slice(-6) : '',
      pending: current ? current.pending : 0,
      count: current ? current.state.habits.length : 0,
      conflict: current ? current.conflict : null,
      lastError: current && current.lastError ? current.lastError : lastError,
      lastSyncedAt: current ? current.lastSyncedAt : '',
      lastAttemptAt
    };
  }

  function notify() {
    if (notificationQueued) return;
    notificationQueued = true;
    Promise.resolve().then(() => {
      notificationQueued = false;
      listeners.forEach(listener => {
        try { listener(); } catch (_) { /* A view must not interrupt durable writes. */ }
      });
    });
  }

  async function exclusive(action) {
    if (busy) throw Error('正在处理，请稍候');
    busy = true;
    let release;
    activeWork = new Promise(resolve => { release = resolve; });
    notify();
    try {
      await action();
    } finally {
      busy = false;
      activeWork = null;
      release();
      notify();
    }
    return status();
  }

  function connected() {
    if (!engine) throw Error('请先阅读说明并同意连接');
  }

  function restoreCachedEngine() {
    if (!configured || !binding.consented()) return;
    try {
      const savedAccount = binding.accountId();
      if (!savedAccount) {
        phase = 'loading';
        return;
      }
      const candidate = createSyncEngine({ storage, call: invoke, accountId: savedAccount, consent: true });
      candidate.read();
      engine = candidate;
      accountId = savedAccount;
      phase = 'ready';
    } catch (error) {
      engine = null;
      accountId = '';
      phase = 'loading';
      lastError = error.message || '本机同步缓存损坏，已停止写入';
    }
  }

  async function loadRemote() {
    const snapshot = await invoke({ action: 'pull' });
    if (!snapshot || !snapshot.ok) throw Error(snapshot && snapshot.message || '读取云端失败');
    if (!engine || accountId !== snapshot.accountId) {
      const candidate = createSyncEngine({ storage, call: invoke, accountId: snapshot.accountId, consent: true });
      if (storage.getStorageSync(PREFIX + snapshot.accountId)) candidate.observeRemote(snapshot);
      else candidate.attach(snapshot);
      candidate.read();
      binding.bind(snapshot.accountId);
      engine = candidate;
      accountId = snapshot.accountId;
    } else {
      engine.observeRemote(snapshot);
    }
    phase = 'ready';
    lastError = '';
  }

  async function start() {
    if (!binding.consented()) {
      phase = 'needsConsent';
      lastError = '';
      notify();
      return status();
    }
    if (!configured) {
      phase = 'loading';
      lastError = '云环境尚未配置';
      notify();
      throw Error(lastError);
    }
    if (!engine) phase = 'loading';
    return exclusive(async () => {
      lastAttemptAt = now();
      try {
        await loadRemote();
      } catch (error) {
        lastError = error.message || '读取云端失败';
        if (engine) {
          phase = 'offline';
          return;
        }
        phase = 'loading';
        throw error;
      }
    });
  }

  async function acceptConsent(consent) {
    if (consent !== true) throw Error('请先阅读并同意数据说明');
    if (!configured) throw Error('云环境尚未配置，本机记录不受影响');
    binding.accept();
    return start();
  }

  function retry() {
    return exclusive(async () => {
      connected();
      if (engine.read().conflict) return;
      lastAttemptAt = now();
      const result = await engine.flush();
      lastError = result.lastError || '';
      phase = result.conflict ? 'conflict' : lastError ? 'offline' : 'ready';
    });
  }

  function refresh() {
    if (!engine) return start();
    return exclusive(async () => {
      connected();
      lastAttemptAt = now();
      try {
        const snapshot = await invoke({ action: 'pull' });
        if (!snapshot || !snapshot.ok) throw Error(snapshot && snapshot.message || '读取失败，已保留缓存');
        engine.observeRemote(snapshot);
        phase = 'ready';
        lastError = '';
      } catch (error) {
        phase = 'offline';
        lastError = error.message || '读取失败，已保留缓存';
        throw error;
      }
    });
  }

  function scheduleFlush() {
    if (!background) {
      background = Promise.resolve().then(async () => {
        if (activeWork) await activeWork;
        return retry();
      })
        .catch(error => {
          lastError = error.message || '同步失败';
          phase = engine ? 'offline' : 'loading';
          return status();
        })
        .finally(() => { background = null; notify(); });
    }
    return background;
  }

  async function foregroundWork(force = false) {
    if (!binding.consented()) {
      phase = 'needsConsent';
      return status();
    }
    if (!engine) return start();
    if (background) await background;
    if (activeWork) await activeWork;
    let current = engine.read();
    if (current.conflict) return status();
    if (current.pending) {
      await retry();
      return status();
    }
    if (!force && now() - lastAttemptAt < 30000) return status();
    await refresh();
    return status();
  }

  function onForeground(force = false) {
    if (!foreground) foreground = foregroundWork(force).finally(() => { foreground = null; });
    return foreground;
  }

  function recoverConnection() {
    if (!recovery) recovery = Promise.resolve().then(async () => {
      // Never race a manual pull, foreground read or queue flush. Queue ids stay intact.
      while (foreground || background || activeWork) {
        await Promise.all([foreground, background, activeWork].filter(Boolean).map(work => work.catch(() => {})));
      }
      return onForeground(true);
    }).finally(() => { recovery = null; });
    return recovery;
  }

  async function purge(confirmation) {
    let result;
    await exclusive(async () => {
      connected();
      result = await engine.purge(confirmation);
      phase = 'ready';
      lastError = '';
      lastAttemptAt = now();
    });
    return result;
  }

  restoreCachedEngine();

  return {
    status,
    start,
    acceptConsent,
    onForeground,
    recoverConnection,
    setNetworkAvailable(available) {
      networkOffline = available === false;
      // A restored link is not proof that the last cloud request succeeded.
      if (networkOffline && engine) phase = 'offline';
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    read() {
      connected();
      return engine.read().state;
    },
    dispatch(command) {
      connected();
      command = JSON.parse(JSON.stringify(command));
      if (command.type === 'simplify') command.target = Number(command.target);
      if (RECORD_TYPES.includes(command.type)) {
        engine.enqueue(command);
        const projected = engine.read().state;
        notify();
        scheduleFlush();
        return projected;
      }
      if (busy) throw Error('同步请求处理中，请稍候');
      return exclusive(async () => {
        const before = engine.read();
        const operationDate = dates.today();
        if (before.pending || before.conflict) throw Error('请先在云同步页处理待同步操作，再修改计划');
        const remote = await invoke({ action: 'pull' });
        if (!remote || !remote.ok) throw Error('在线确认失败，未提交计划修改');
        engine.observeRemote(remote);
        if (dates.today() !== operationDate) throw Error('日期已变化，请重新确认计划修改');
        engine.enqueue(command, true);
        const result = await engine.flush();
        if (result.pending || result.conflict) throw Error('修改尚未确认，请到云同步页重试或处理冲突，勿重复提交');
        phase = 'ready';
        lastError = '';
      }).then(() => engine.read().state);
    },
    refresh,
    retry,
    purge,
    useRemote(confirmation) {
      return exclusive(async () => {
        connected();
        engine.useRemote(confirmation);
        phase = 'ready';
        lastError = '';
      });
    },
    backup() {
      connected();
      return JSON.stringify({
        format: 'yidian-cloud-backup-v1',
        current: JSON.parse(engine.exportPending()),
        recovery: engine.exportRecovery() ? JSON.parse(engine.exportRecovery()) : null
      });
    }
  };
}

module.exports = { createCloudSession };
