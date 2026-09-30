// 目标按运行版本解析：开发版/体验版连共享测试环境，正式版连共享正式环境（资源方 weddingTodo）。
// 云是唯一数据源；跨账号调用经 wx.cloud.Cloud 共享实例完成，客户端不直读写数据库/存储。
// Node（测试）里没有 wx，按 develop 解析；release 目标与 deploy/product-resources.json 一致，测试拦截漂移。
const resources = require('./cloud-resources');

const TARGETS = Object.freeze({
  test: Object.freeze({
    enabled: true,
    mode: 'shared',
    envId: 'cloud1-d8gopnalv908bb47a',
    resourceAppid: 'wx7ad85943fe81e095',
    functionName: resources.apiFunction,
    storageNamespace: 'jiancheng_daka',
    completeMinimumEnabled: true
  }),
  product: Object.freeze({
    enabled: true,
    mode: 'shared',
    envId: 'product-d2g59zty74d7d1ec1',
    resourceAppid: 'wx7ad85943fe81e095',
    functionName: resources.apiFunction,
    storageNamespace: 'jiancheng_daka',
    completeMinimumEnabled: true
  })
});

function resolveCloudConfig(envVersion = 'develop') {
  return envVersion === 'release' ? TARGETS.product : TARGETS.test;
}

function currentEnvVersion() {
  try {
    const info = typeof wx !== 'undefined' && typeof wx.getAccountInfoSync === 'function'
      ? wx.getAccountInfoSync()
      : null;
    const version = info && info.miniProgram && info.miniProgram.envVersion;
    return typeof version === 'string' && version ? version : 'develop';
  } catch (_) {
    return 'develop';
  }
}

module.exports = { ...resolveCloudConfig(currentEnvVersion()), TARGETS, resolveCloudConfig };
