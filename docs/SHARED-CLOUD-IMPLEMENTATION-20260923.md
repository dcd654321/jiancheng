# 共享正式云接入实施核对

日期：2026-09-23。分支：`dev`。对应 OpenSpec 变更：`connect-shared-production-cloud`。

## 任务 1.1：当前代码与测试基线

- `miniprogram/config/cloud.js` 仍启用旧测试环境及 `habitApi`；`cloud.product.js` 关闭且环境 ID 为空，未包含资源方 AppID。与提案的“正式环境未接入”描述一致。
- `miniprogram/services/cloud-transport.js` 当前通过默认 `wx.cloud.init` 和 `wx.cloud.callFunction` 调用；初始化是同步标记，不能直接满足共享实例必须等待异步 `init()` 的设计。与提案的拟新增行为一致。
- `miniprogram/services/cloud-session.js` 把配置传给传输层，并按环境 ID 与命名空间隔离同意、绑定、快照和队列。`cloud.product.js` 已预留正式命名空间，但它尚未活动；旧缓存不会因本次核对被迁移。
- `server/handler.js` 仅接受受信上下文的 `APPID`、`OPENID`、`SOURCE`，按 `APPID:OPENID` 生成账户键；`cloudfunctions/jiancheng_daka_api/index.js` 以服务端环境变量和 `getWXContext()` 为门控。共享调用的 `FROM_*` 字段尚未适配，不能在未经确认时把资源方身份当使用方身份。
- 本项目数据集合固定为 `jiancheng_daka_accounts`，服务端事务、回执和版本冲突处理已有实现。当前测试覆盖旧云调用、专属资源名、缓存分离、伪造 event 身份、双用户隔离和幂等，但没有真实跨小程序身份、正式云访问规则和真机证据。

核对文件：`tests/cloud-resources.test.cjs`、`tests/cloud-entry.test.cjs`、`tests/cloud.test.cjs`、`tests/cloud-session.test.cjs`、`tests/workspace.test.cjs`。本节是源码和测试清单核对，不表示远端已验收。

## 只读云端核对与身份验证边界

通过微信开发者工具 CLI，以资源方 AppID `wx7ad85943fe81e095` 查询到 `product-d2g59zty74d7d1ec1`；该环境的函数列表包括本项目 `jiancheng_daka_api`，也包括其他小程序的函数。`functions info` 显示本项目函数为 Active；该只读输出没有给出可验证的变量值、集合规则、环境共享授权或来源身份映射。用使用方项目直接列环境只显示旧测试环境，因此不可把“资源方环境存在”当作“使用方可调用”的证据。本次未修改远端任何资源。

[腾讯云开发官方文档](https://docs.cloudbase.net/run/develop/access/mini)说明共享资源访问使用 `new wx.cloud.Cloud({resourceAppid, resourceEnv})` 并等待 `init()`。该页示例针对云托管，不能证明本项目云函数返回的 `getWXContext()` 身份字段。任务 1.2 仍需官方身份字段语义及本项目受控调用，1.3 仍需共享关系、变量、集合权限和可恢复配置核验。取得证据前不修改账户身份映射，也不启用正式目标。

## 本地客户端实现与回归

- `cloud.product.js` 填入已只读核实的资源方 AppID、环境 ID 和共享模式，但 `enabled` 仍为 `false`；活动 `cloud.js` 仍指向旧测试环境。没有正式环境调用或切换。
- `cloud-transport.js` 在共享模式下只创建独立实例，等待单次合并的异步初始化后调用 `jiancheng_daka_api`。初始化失败清除初始化 Promise，下一次调用可重试；不调用默认 `wx.cloud`，不回退 `habitApi`。缺少同意、资源标识或实例接口时在业务请求前拒绝。
- `cloud-session.js` 验证共享配置完整性；未启用或错误配置时不写本地同意记录，不开放可编辑空账户。正式缓存与队列按正式环境 ID 和 `jiancheng_daka` 命名空间隔离；旧测试数据保持原位。
- `tests/cloud-resources.test.cjs` 新增共享初始化并发、失败重试、错误配置、正式入口关闭、旧队列与正式离线首次接入隔离；现有 `cloud-session.test.cjs` 和 `sync.test.cjs` 覆盖离线恢复、冲突与待同步意图保留。以上均为本地模拟，不是正式云实测。
- `server/cloudbase-repository.js` 将数据限制在 `jiancheng_daka_accounts`，事务内提交状态与回执；`server/handler.js` 按受信身份派生账户键，保留冲突及幂等判断。`tests/cloud.test.cjs` 的双用户隔离、丢失确认重试、多设备版本冲突和错误路径验证通过；客户端 `sync.test.cjs` 验证冲突时待同步意图保留。这是代码及模拟仓库核对，远端集合与权限仍归任务 1.3/4.3。
- 本项目服务端入口和处理器没有业务 `console` 日志；非预期 SDK 错误返回固定的 `SERVICE_UNAVAILABLE` 文案，非法长备注返回固定校验错误。新增测试把模拟密钥、原始用户标识和备注放进错误路径，确认响应不回显这些值。平台侧自动诊断日志未在本轮验证。

验证环境 Node.js `v24.19.0`（直接测试）及系统 npm 所用 Node.js `v24.21.0`。最终 `npm test` 200/200 通过；`npm run check` 118 项通过；`npm run check:cloud` 5 个云函数模块与源代码一致；`npm run openspec -- validate --all --strict` 1/1 通过。新增测试开发中曾因关闭的正式配置仍可写本地同意记录失败，已修复并复测通过。微信开发者工具编译、真机与正式云调用尚未作为本轮验证结论。

## 回退与未完成事项

本轮只有本地代码与文档改动，无远端写入。回退可对本轮提交执行 Git revert；已有旧测试缓存和正式预留缓存不删除、不搬迁。后续必须先验证共享身份与本项目资源权限，再适配服务端身份、受控部署和双账户实测；远端验证通过前不能将 `cloud.product.js` 设为活动目标，也不能把本轮本地测试称作上线验收。
