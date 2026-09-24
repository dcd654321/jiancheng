const domain = require('../core/habits');
const dates = require('../core/date');
const RECORD_TYPES = ['complete', 'completeMinimum', 'undo', 'simplify', 'restore', 'note'];
const ONLINE_TYPES = ['create', 'edit', 'status', 'cancelFuture', 'settings'];
const clone = value => JSON.parse(JSON.stringify(value));
const PREFIX = 'yidian.sync.v1:';

/** Offline records plus durable receipts for explicitly initiated online management requests. */
function createSyncEngine({ storage, call, accountId, consent, clock = dates.today, newId = () => 'op_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2) }) {
  if (consent !== true || !/^[a-f0-9]{64}$/.test(accountId || '') || typeof call !== 'function') throw Error('同步需要明确授权和已验证的账户绑定');
  const key = PREFIX + accountId;
  let running = null;

  function validateSnapshot(value) {
    if (!value || value.accountId !== accountId || typeof value.epoch !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(value.epoch) || !Number.isSafeInteger(value.revision) || value.revision < 0) throw Error('云端账户或版本不匹配，未覆盖本机数据');
    dates.assertDate(value.serverDate);
    domain.validateState(value.state);
    return value;
  }
  function load() {
    const raw = storage.getStorageSync(key);
    if (!raw) throw Error('请先连接并确认云端账户');
    let data;
    try { data = JSON.parse(raw); } catch (_) { throw Error('同步缓存损坏，已停止写入'); }
    if (!data || data.schemaVersion !== 1 || !Array.isArray(data.queue) || data.queue.length > 200) throw Error('同步缓存格式无效');
    validateSnapshot(data.base);
    const seen = new Set();
    data.queue.forEach((item, index) => {
      const e = item.event;
      const record = e && e.command && RECORD_TYPES.includes(e.command.type);
      const online = e && e.command && ONLINE_TYPES.includes(e.command.type) && item.online === true;
      if (!e || e.action !== 'mutate' || (!record && !online) || typeof e.operationId !== 'string' || seen.has(e.operationId) || e.epoch !== data.base.epoch || e.expectedRevision !== data.base.revision + index || (record && e.command.date !== e.operationDate)) throw Error('待同步队列格式无效，未覆盖记录');
      dates.assertDate(e.operationDate); seen.add(e.operationId);
    });
    if (data.conflict && data.conflict.snapshot) validateSnapshot(data.conflict.snapshot);
    return data;
  }
  function save(value) {
    try { storage.setStorageSync(key, JSON.stringify(value)); }
    catch (_) { throw Error('同步缓存保存失败，不能确认本次操作；请重试'); }
  }
  function project(envelope) {
    let state = clone(envelope.base.state);
    envelope.queue.forEach(item => { state = domain.reduce(state, item.event.command, item.event.operationDate); });
    return domain.validateState(state);
  }
  function attach(snapshot) {
    validateSnapshot(snapshot);
    if (storage.getStorageSync(key)) throw Error('已有同步缓存，请刷新而不是覆盖');
    save({ schemaVersion: 1, base: clone(snapshot), queue: [], conflict: null, lastError: '', lastSyncedAt: new Date().toISOString() });
  }
  function read() {
    const envelope = load();
    return { state: project(envelope), pending: envelope.queue.length, conflict: clone(envelope.conflict),
      lastError: envelope.lastError, lastSyncedAt: envelope.lastSyncedAt, accountId, epoch: envelope.base.epoch };
  }
  function enqueue(command, online = false) {
    const envelope = load();
    if (envelope.conflict) throw Error('请先处理同步冲突，再添加操作');
    const management = command && ONLINE_TYPES.includes(command.type) && online === true;
    if (!command || (!RECORD_TYPES.includes(command.type) && !management)) throw Error('此队列只接受打卡、撤销、今天简化和备注，长期修改需在线确认');
    if (envelope.queue.some(item => item.online) || (management && envelope.queue.length)) throw Error('请先确认待同步操作，再修改计划或添加记录');
    const operationDate = clock();
    if (!management && command.date !== operationDate) throw Error('只能为今天创建新的离线操作');
    if (envelope.queue.length >= 200) throw Error('待同步操作较多，请先联网同步或导出');
    const operationId = newId();
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(operationId) || envelope.queue.some(i => i.event.operationId === operationId)) throw Error('操作标识重复，请重试');
    envelope.queue.push({ online: management, event: { action: 'mutate', operationId, epoch: envelope.base.epoch,
      expectedRevision: envelope.base.revision + envelope.queue.length, operationDate, command: clone(command) } });
    project(envelope); // Validate before making the optimistic record visible.
    save(envelope);
    return operationId;
  }
  async function drain() {
    let envelope = load();
    if (envelope.conflict) return read();
    while (envelope.queue.length) {
      const head = clone(envelope.queue[0]);
      let result;
      try { result = await call(head.event); }
      catch (_) {
        envelope = load(); envelope.lastError = '网络或服务异常，待同步操作已保留'; save(envelope); return read();
      }
      envelope = load();
      if (!envelope.queue[0] || envelope.queue[0].event.operationId !== head.event.operationId) throw Error('同步队列已变化，停止本次提交');
      if (!result || typeof result.ok !== 'boolean') throw Error('云端响应无效，待同步操作已保留');
      if (!result.ok) {
        if (result.snapshot) validateSnapshot(result.snapshot);
        if (['CONFLICT', 'EPOCH_CHANGED'].includes(result.code)) {
          if (!result.snapshot) throw Error('冲突响应缺少云端快照');
          envelope.conflict = { code: result.code, snapshot: clone(result.snapshot) };
        } else if (result.code !== 'SERVICE_UNAVAILABLE') {
          // Terminal rejection must stay visible instead of retrying forever or silently dropping the event.
          envelope.conflict = { code: result.code || 'REJECTED', snapshot: null };
        }
        envelope.lastError = result.message || '同步未完成'; save(envelope); return read();
      }
      validateSnapshot(result);
      if (result.operationId !== head.event.operationId || result.appliedRevision !== head.event.expectedRevision + 1 || result.revision < result.appliedRevision || result.epoch !== envelope.base.epoch) throw Error('同步确认与请求不匹配，队列已保留');
      envelope.queue.shift();
      if (envelope.queue.length && result.revision !== result.appliedRevision) {
        // A receipt may be replayed after another device has already changed the server.
        // Keep the known pre-conflict local projection; do not rebase remaining intents silently.
        envelope.base.state = domain.reduce(envelope.base.state, head.event.command, head.event.operationDate);
        envelope.base.revision = result.appliedRevision;
        envelope.conflict = { code: 'REMOTE_ADVANCED', snapshot: clone(result) };
        envelope.lastError = '已有操作确认，但其他设备随后修改了数据，请查看剩余冲突';
      } else {
        envelope.base = clone(result); envelope.lastError = '';
      }
      envelope.lastSyncedAt = new Date().toISOString();
      save(envelope); // Queue head is removed only if the acknowledgement persists successfully.
      if (envelope.conflict) return read();
    }
    return read();
  }
  function flush() {
    if (!running) running = drain().finally(() => { running = null; });
    return running;
  }
  async function refresh() {
    let envelope = load();
    if (running) await running;
    envelope = load();
    if (envelope.queue.length && !envelope.conflict) return flush();
    const result = await call({ action: 'pull' });
    if (!result || !result.ok) throw Error('读取云端失败，本机数据未改变');
    return observeRemote(result);
  }
  function observeRemote(result) {
    validateSnapshot(result);
    const envelope = load();
    // A slow pull must not roll back a newer mutation acknowledgement persisted while it was in flight.
    if (result.revision < envelope.base.revision) return read();
    if (envelope.queue.length && !envelope.conflict && result.revision === envelope.base.revision && result.epoch === envelope.base.epoch) return read();
    if (envelope.queue.length || envelope.conflict) {
      envelope.conflict = { code: envelope.conflict ? envelope.conflict.code : 'REMOTE_REFRESH', snapshot: clone(result) };
    } else { envelope.base = clone(result); envelope.lastError = ''; envelope.lastSyncedAt = new Date().toISOString(); }
    save(envelope); return read();
  }
  function useRemote(confirmation) {
    if (running) throw Error('正在同步，请等待当前请求完成');
    const envelope = load();
    if (confirmation !== 'DISCARD_PENDING' || !envelope.conflict || !envelope.conflict.snapshot) throw Error('需先获取冲突快照并明确确认舍弃本机待同步操作');
    validateSnapshot(envelope.conflict.snapshot);
    // Recoverable local backup comes before any destructive queue replacement.
    storage.setStorageSync(key + ':recovery', JSON.stringify(envelope));
    save({ schemaVersion: 1, base: clone(envelope.conflict.snapshot), queue: [], conflict: null, lastError: '', lastSyncedAt: new Date().toISOString() });
    return read();
  }
  async function purge(confirmation) {
    if (confirmation !== 'DELETE_MY_DATA') throw Error('删除数据需要明确确认');
    if (running) throw Error('正在同步，请等待当前请求完成');
    const envelope = load();
    if (envelope.queue.length || envelope.conflict) throw Error('请先处理待同步操作或冲突');
    const operationId = newId();
    const event = { action: 'purge', operationId, epoch: envelope.base.epoch,
      expectedRevision: envelope.base.revision, operationDate: clock(), confirmation: 'DELETE_MY_DATA' };
    const result = await call(event);
    if (!result || result.ok !== true) throw Error(result && result.message || '云端未确认删除，本机数据未清理');
    validateSnapshot(result);
    const empty = result.state.habits.length === 0 && Object.keys(result.state.records).length === 0;
    if (result.operationId !== operationId || result.appliedRevision !== envelope.base.revision + 1 ||
      result.revision !== result.appliedRevision || result.epoch === envelope.base.epoch || !empty) {
      throw Error('云端删除确认无效，本机数据未清理');
    }
    save({ schemaVersion: 1, base: clone(result), queue: [], conflict: null,
      lastError: '', lastSyncedAt: new Date().toISOString() });
    storage.removeStorageSync(key + ':recovery');
    return read();
  }
  return { attach, read, enqueue, flush, refresh, observeRemote, useRemote, purge, exportRecovery: () => storage.getStorageSync(key + ':recovery'),
    exportPending: () => storage.getStorageSync(key) };
}
module.exports = { createSyncEngine, PREFIX };
