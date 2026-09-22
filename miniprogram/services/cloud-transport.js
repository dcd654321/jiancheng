const { apiFunction } = require('../config/cloud-resources');

/** Cloud-authoritative workspace transport; identity comes only from the server context. */
function createCloudTransport(wxApi, { enabled, envId, consent, functionName = apiFunction } = {}) {
  if (enabled !== true || consent !== true || typeof envId !== 'string' || !envId.trim()) throw Error('云功能需配置环境并取得用户同意后启用');
  if (typeof functionName !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_-]{0,59}$/.test(functionName)) throw Error('云函数名称无效');
  if (!wxApi.cloud || typeof wxApi.cloud.callFunction !== 'function') throw Error('当前环境不支持微信云开发');
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
