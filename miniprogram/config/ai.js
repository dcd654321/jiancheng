// 允许主动申请 AI；服务端仍检查身份、审核目录和真实预算。
// 密钥只在服务端；客户端开关不代表云端已经配置或部署。
const { planFunction } = require('./cloud-resources');
module.exports = { enabled: true, functionName: planFunction, timeoutMs: 12000 };
