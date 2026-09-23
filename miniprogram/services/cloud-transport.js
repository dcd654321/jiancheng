const { apiFunction } = require('../config/cloud-resources');

/** Cloud-authoritative workspace transport; identity comes only from the server context. */
function createCloudTransport(wxApi, { enabled, envId, consent, functionName = apiFunction, mode = 'default', resourceAppid } = {}) {
  if (enabled !== true || consent !== true || typeof envId !== 'string' || !envId.trim()) throw Error('云功能需配置环境并取得用户同意后启用');
  if (typeof functionName !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_-]{0,59}$/.test(functionName)) throw Error('云函数名称无效');
  if (mode !== 'default' && mode !== 'shared') throw Error('云访问模式无效');
  if (!wxApi || !wxApi.cloud) throw Error('当前环境不支持微信云开发');
  if (mode === 'shared') {
    if (typeof resourceAppid !== 'string' || !/^wx[a-f0-9]{16}$/.test(resourceAppid)) throw Error('共享云资源方 AppID 无效');
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(envId) || envId.startsWith('YOUR_')) throw Error('共享云环境标识无效');
    if (functionName !== apiFunction) throw Error('共享云仅允许调用本项目专属函数');
    if (typeof wxApi.cloud.Cloud !== 'function') throw Error('当前环境不支持共享云实例');
    let initPromise = null;
    function ready() {
      if (!initPromise) {
        const instance = new wxApi.cloud.Cloud({ resourceAppid, resourceEnv: envId });
        if (typeof instance.init !== 'function' || typeof instance.callFunction !== 'function') throw Error('共享云实例接口不可用');
        initPromise = Promise.resolve().then(() => instance.init()).then(() => instance).catch(error => {
          initPromise = null;
          throw error;
        });
      }
      return initPromise;
    }
    return async event => {
      const instance = await ready();
      const response = await instance.callFunction({ name: functionName, data: event });
      if (!response || !response.result || typeof response.result.ok !== 'boolean') throw Error('云端响应格式错误，待同步操作已保留');
      return response.result;
    };
  }
  if (typeof wxApi.cloud.callFunction !== 'function') throw Error('当前环境不支持微信云开发');
  let initialized = false;
  return async event => {
    if (!initialized) {
      wxApi.cloud.init({ env: envId, traceUser: false });
      initialized = true;
    }
    const response = await wxApi.cloud.callFunction({ name: functionName, data: event, config: { env: envId } });
    if (!response || !response.result || typeof response.result.ok !== 'boolean') throw Error('云端响应格式错误，待同步操作已保留');
    return response.result;
  };
}
module.exports = { createCloudTransport };
