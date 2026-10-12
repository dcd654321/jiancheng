const { apiFunction, featuresFunction, publicShareFunction, monitorFunction } = require('../config/cloud-resources');
// Only initialized SDK connections are reused in memory; no account data is cached here.
const sharedConnections = new WeakMap();
const telemetryObservers = new WeakMap();

function setCloudTelemetryObserver(wxApi, observer) {
  if (!wxApi || (typeof wxApi !== 'object' && typeof wxApi !== 'function')) return () => {};
  telemetryObservers.set(wxApi, observer);
  return () => { if (telemetryObservers.get(wxApi) === observer) telemetryObservers.delete(wxApi); };
}

function measured(wxApi, functionName, invoke) {
  if (functionName === monitorFunction) return invoke;
  return async event => {
    const observer = telemetryObservers.get(wxApi);
    let context;
    try { context = observer && observer.capture(); } catch (_) { /* Monitoring cannot interrupt business calls. */ }
    const startedAt = Date.now();
    let code = 'CLOUD_CALL_FAILED';
    try {
      const result = await invoke(event);
      code = result.ok ? 'OK' : typeof result.code === 'string' && /^[A-Z0-9_]{1,64}$/.test(result.code) ? result.code : 'CLOUD_REJECTED';
      return result;
    } finally {
      try { if (observer) observer.recordPerformance(context, functionName, Math.max(0, Date.now() - startedAt), code); } catch (_) { /* Best effort only. */ }
    }
  };
}

/** Cloud-authoritative workspace transport; identity comes only from the server context. */
function createCloudTransport(wxApi, { enabled, envId, functionName = apiFunction, mode = 'default', resourceAppid } = {}) {
  if (enabled !== true || typeof envId !== 'string' || !envId.trim()) throw Error('云环境尚未配置');
  if (typeof functionName !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_-]{0,59}$/.test(functionName)) throw Error('云函数名称无效');
  if (mode !== 'default' && mode !== 'shared') throw Error('云访问模式无效');
  if (!wxApi || !wxApi.cloud) throw Error('当前环境不支持微信云开发');
  if (mode === 'shared') {
    if (typeof resourceAppid !== 'string' || !/^wx[a-f0-9]{16}$/.test(resourceAppid)) throw Error('共享云资源方 AppID 无效');
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(envId) || envId.startsWith('YOUR_')) throw Error('共享云环境标识无效');
    if (![apiFunction, featuresFunction, publicShareFunction, monitorFunction].includes(functionName)) throw Error('共享云仅允许调用本项目专属函数与运营监控函数');
    if (typeof wxApi.cloud.Cloud !== 'function') throw Error('当前环境不支持共享云实例');
    function ready() {
      let targets = sharedConnections.get(wxApi.cloud);
      if (!targets) { targets = new Map(); sharedConnections.set(wxApi.cloud, targets); }
      const key = resourceAppid + ':' + envId;
      let entry = targets.get(key);
      if (!entry) {
        const instance = new wxApi.cloud.Cloud({ resourceAppid, resourceEnv: envId });
        if (typeof instance.init !== 'function' || typeof instance.callFunction !== 'function') throw Error('共享云实例接口不可用');
        entry = {};
        entry.work = Promise.resolve().then(() => instance.init()).then(result => {
          // Some shared authorization failures resolve instead of rejecting.
          // Do not mask that failure with a later "cloud not initialized" error.
          if (result && typeof result === 'object' && 'errCode' in result && result.errCode !== 0) {
            const denied = result.errCode === 403;
            const error = Error(denied ? '正式云共享权限尚未开通，请联系开发者处理' : '云服务初始化失败，请稍后重试');
            error.code = denied ? 'SHARED_CLOUD_PERMISSION_DENIED' : 'SHARED_CLOUD_INIT_FAILED';
            throw error;
          }
          return instance;
        }).catch(error => {
          if (targets.get(key) === entry) targets.delete(key);
          throw error;
        });
        targets.set(key, entry);
      }
      return entry.work;
    }
    return measured(wxApi, functionName, async event => {
      const instance = await ready();
      const response = await instance.callFunction({ name: functionName, data: event });
      if (!response || !response.result || typeof response.result.ok !== 'boolean') throw Error('云端响应格式错误，操作结果未确认，请重试');
      return response.result;
    });
  }
  if (typeof wxApi.cloud.callFunction !== 'function') throw Error('当前环境不支持微信云开发');
  let initialized = false;
  return measured(wxApi, functionName, async event => {
    if (!initialized) {
      wxApi.cloud.init({ env: envId, traceUser: false });
      initialized = true;
    }
    const response = await wxApi.cloud.callFunction({ name: functionName, data: event, config: { env: envId } });
    if (!response || !response.result || typeof response.result.ok !== 'boolean') throw Error('云端响应格式错误，操作结果未确认，请重试');
    return response.result;
  });
}
module.exports = { createCloudTransport, setCloudTelemetryObserver };
