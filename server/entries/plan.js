'use strict';

// 保留旧客户端接口；无需 SDK、环境配置、账户读取或生成服务。
exports.main = async () => ({
  ok: false,
  code: 'NOT_ENABLED',
  message: '该功能已停用，请更新小程序后添加习惯'
});
