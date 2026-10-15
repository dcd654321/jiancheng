const { apiFunction, featuresFunction, publicShareFunction, monitorFunction } = require('../config/cloud-resources');
// Only initialized SDK connections are reused in memory; no account data is cached here.
const sharedConnections = new WeakMap();
const telemetryObservers = new WeakMap();
const READ_TIMEOUT_MS = 8000;

function withTimeout(invoke, timeoutMs = READ_TIMEOUT_MS, options = {}, code = 'CLOUD_READ_TIMEOUT', message = '连接时间有些长，请重新读取') {
  const setTimer = options.setTimer || setTimeout, clearTimer = options.clearTimer || clearTimeout;
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true; clearTimer(timer); callback(value);
    };
    const timer = setTimer(() => {
      const error = Error(message); error.code = code; finish(reject, error);
    }, timeoutMs);
    try { Promise.resolve(invoke()).then(value => finish(resolve, value), error => finish(reject, error)); }
    catch (error) { finish(reject, error); }
  });
}

function recordTiming(options, stage, startedAt, code) {
  try {
    if (typeof options.onTiming === 'function') options.onTiming({ stage,
      durationMs: Math.max(0, (options.now || Date.now)() - startedAt), code });
  } catch (_) { /* Diagnostics cannot interrupt account data. */ }
}

function sharedReady(wxApi, resourceAppid, envId, options = {}) {
  let targets = sharedConnections.get(wxApi.cloud);
  if (!targets) { targets = new Map(); sharedConnections.set(wxApi.cloud, targets); }
  const key = resourceAppid + ':' + envId;
  let entry = targets.get(key);
  if (!entry) {
    const instance = new wxApi.cloud.Cloud({ resourceAppid, resourceEnv: envId });
    if (typeof instance.init !== 'function' || typeof instance.callFunction !== 'function') throw Error('共享云实例接口不可用');
    entry = {};
    const startedAt = (options.now || Date.now)();
    // Begin native authentication now so optional module loading can overlap it.
    entry.work = withTimeout(() => instance.init(), options.initTimeoutMs || READ_TIMEOUT_MS, options,
      'CLOUD_INIT_TIMEOUT', '云服务连接时间过长，请重新读取').then(result => {
      if (result && typeof result === 'object' && 'errCode' in result && result.errCode !== 0) {
        const denied = result.errCode === 403;
        const error = Error(denied ? '正式云共享权限尚未开通，请联系开发者处理' : '云服务初始化失败，请稍后重试');
        error.code = denied ? 'SHARED_CLOUD_PERMISSION_DENIED' : 'SHARED_CLOUD_INIT_FAILED';
        throw error;
      }
      recordTiming(options, 'shared_init', startedAt, 'OK');
      return instance;
    }).catch(error => {
      if (targets.get(key) === entry) targets.delete(key);
      recordTiming(options, 'shared_init', startedAt, error.code === 'CLOUD_INIT_TIMEOUT' ? 'TIMEOUT' : 'FAILED');
      throw error;
    });
    targets.set(key, entry);
  }
  return entry.work;
}

function setCloudTelemetryObserver(wxApi, observer) {
  if (!wxApi || (typeof wxApi !== 'object' && typeof wxApi !== 'function')) return () => {};
  telemetryObservers.set(wxApi, observer);
  return () => { if (telemetryObservers.get(wxApi) === observer) telemetryObservers.delete(wxApi); };
}

function measured(wxApi, functionName, invoke) {
  if (functionName === monitorFunction) return invoke;
  return async (event, request) => {
    const observer = telemetryObservers.get(wxApi);
    let context;
    try { context = observer && observer.capture(); } catch (_) { /* Monitoring cannot interrupt business calls. */ }
    const startedAt = Date.now();
    let code = 'CLOUD_CALL_FAILED';
    try {
      const result = await invoke(event, request);
      code = result.ok ? 'OK' : typeof result.code === 'string' && /^[A-Z0-9_]{1,64}$/.test(result.code) ? result.code : 'CLOUD_REJECTED';
      return result;
    } finally {
      try { if (observer) observer.recordPerformance(context, functionName, Math.max(0, Date.now() - startedAt), code); } catch (_) { /* Best effort only. */ }
    }
  };
}

/** Cloud-authoritative workspace transport; identity comes only from the server context. */
function createCloudTransport(wxApi, { enabled, envId, functionName = apiFunction, mode = 'default', resourceAppid } = {}, options = {}) {
  if (enabled !== true || typeof envId !== 'string' || !envId.trim()) throw Error('云环境尚未配置');
  if (typeof functionName !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_-]{0,59}$/.test(functionName)) throw Error('云函数名称无效');
  if (mode !== 'default' && mode !== 'shared') throw Error('云访问模式无效');
  if (!wxApi || !wxApi.cloud) throw Error('当前环境不支持微信云开发');
  if (mode === 'shared') {
    if (typeof resourceAppid !== 'string' || !/^wx[a-f0-9]{16}$/.test(resourceAppid)) throw Error('共享云资源方 AppID 无效');
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(envId) || envId.startsWith('YOUR_')) throw Error('共享云环境标识无效');
    if (![apiFunction, featuresFunction, publicShareFunction, monitorFunction].includes(functionName)) throw Error('共享云仅允许调用本项目专属函数与运营监控函数');
    if (typeof wxApi.cloud.Cloud !== 'function') throw Error('当前环境不支持共享云实例');
    const transport = measured(wxApi, functionName, async (event, request) => {
      const instance = await sharedReady(wxApi, resourceAppid, envId, options);
      assertCurrentRead(request);
      const response = await call(instance, event);
      if (!response || !response.result || typeof response.result.ok !== 'boolean') throw Error('云端响应格式错误，操作结果未确认，请重试');
      return response.result;
    });
    transport.prepare = () => sharedReady(wxApi, resourceAppid, envId, options).then(() => undefined);
    return transport;
  }
  if (typeof wxApi.cloud.callFunction !== 'function') throw Error('当前环境不支持微信云开发');
  let initialized = false;
  return measured(wxApi, functionName, async (event, request) => {
    assertCurrentRead(request);
    if (!initialized) {
      wxApi.cloud.init({ env: envId, traceUser: false });
      initialized = true;
    }
    const response = await call(wxApi.cloud, event, { config: { env: envId } });
    if (!response || !response.result || typeof response.result.ok !== 'boolean') throw Error('云端响应格式错误，操作结果未确认，请重试');
    return response.result;
  });

  async function call(instance, event, extra = {}) {
    const startedAt = (options.now || Date.now)();
    let code = 'FAILED';
    try {
      const response = await instance.callFunction({ name: functionName, data: event, ...extra });
      if (response && response.result && response.result.ok === true) code = 'OK';
      return response;
    } finally {
      if (event && event.action === 'pull') recordTiming(options, 'account_pull', startedAt, code);
    }
  }
}

// A read may expire while native authentication is still pending. Do not send
// that expired request when the shared connection eventually becomes ready.
function assertCurrentRead(request) {
  if (request && typeof request.isCurrent === 'function' && !request.isCurrent()) {
    const error = Error('读取已结束，请重新读取'); error.code = 'CLOUD_READ_TIMEOUT'; throw error;
  }
}

function prepareCloudConnection(wxApi, config, options) {
  const transport = createCloudTransport(wxApi, config, options);
  return transport.prepare ? transport.prepare() : Promise.resolve();
}

/** Uploads only user-selected temporary pictures to a server-issued project path. */
function createCloudStorage(wxApi, config = {}) {
  // Validate the same target as the authenticated business transport. No fallback.
  createCloudTransport(wxApi, { ...config, functionName: featuresFunction });
  let initialized = false;
  return {
    async upload({ cloudPath, filePath } = {}) {
      if (typeof cloudPath !== 'string' || cloudPath.length > 400 ||
        !/^jiancheng_daka_media\/uploads\/[a-f0-9]{64}\/[a-zA-Z0-9_-]{1,100}\/[a-f0-9]{64}\.(?:jpg|png)$/.test(cloudPath) ||
        typeof filePath !== 'string' || !filePath || filePath.length > 2048) throw Error('照片上传目标无效');
      let instance;
      if (config.mode === 'shared') instance = await sharedReady(wxApi, config.resourceAppid, config.envId);
      else {
        instance = wxApi.cloud;
        if (!initialized) { instance.init({ env: config.envId, traceUser: false }); initialized = true; }
      }
      if (typeof instance.uploadFile !== 'function') throw Error('当前环境不支持照片上传');
      const response = await instance.uploadFile({ cloudPath, filePath, ...(config.mode === 'shared' ? {} : { config: { env: config.envId } }) });
      if (!response || typeof response.fileID !== 'string' || !response.fileID.startsWith('cloud://') || response.fileID.length > 1024 ||
        ('errCode' in response && response.errCode !== 0)) throw Error('照片上传结果未确认，请保留当前页面重试');
      return { fileID: response.fileID };
    }
  };
}
module.exports = { createCloudTransport, createCloudStorage, prepareCloudConnection, setCloudTelemetryObserver, withTimeout, recordTiming, READ_TIMEOUT_MS };
