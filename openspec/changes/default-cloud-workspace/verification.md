# Verification

2026-09-28，本地 `dev` 分支：

- `npm test`：302/302 通过，包括无云同意标记自动启动、首次失败不可编辑、同步页重试、缓存恢复和页面无旧按钮。
- `npm run check`：239 项通过。
- `npm run check:cloud`：61 个云包文件与源代码一致；本变更没有修改或部署云函数。
- `npm run openspec -- validate --all --strict`：11/11 通过。
- `node scripts/check-native.cjs 'E:\weixinDevTool\微信web开发者工具'`：16 个 WXML 输入及全部 WXSS 通过微信原生编译器语法检查。
- 未完成：微信开发者工具模拟器渲染、真机首启与弱网、双微信账号隔离。本地测试与编译不能代替这些验收。

活动配置仍为项目测试云 `cloud1-d4gq76oyt363f08a7`；未切换共享正式环境，未修改云端资源或数据库。
