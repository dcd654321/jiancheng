# 单个习惯删除实施记录

2026-10-10，按用户“先把删除的功能做了”的要求在 `dev` 实施。对应 OpenSpec 变更为 `allow-delete-habit`。

## 行为

习惯详情 → 更多操作 → 删除习惯。进行中、暂停、归档和尚未开始的习惯均有入口；确认弹窗显示名称、不可恢复的删除范围，以及已有公开分享需单独撤销的提示。有未保存备注时提示草稿将丢弃。

提交 `deleteHabit { id, baseRevision }` 后，云端同一事务移除该账户的目标习惯、全部历史打卡、备注及待生效计划，并清除命中的置顶引用。保留账户 epoch、其他习惯、其他记录、主题、提醒设置、分享索引和偏好回执。偏好缺失不创建文档；任一事务读写或格式校验失败整体回滚。

只有合法云回执确认后清理目标会话草稿，返回“我的习惯”并显示“习惯已删除”。取消或明确拒绝保留原数据；结果未知保留原 operationId 核对。弹窗确认绑定账户、日期、习惯版本、账户状态版本和页面访问版本，旧回调不能误删或导航新页面。导航失败显示“返回我的习惯”出口。最后一项删除后管理清单为空并保留添加入口，今日使用现有添加习惯空态。返回位置于 2026-10-10 按用户反馈修正；后续回归与性能记录见 `docs/DELETE-AND-LATENCY-20261010.md`。

已创建的公开分享继续按独立快照访问，可在分享管理中撤销；新分享不能选择已删除目标，删除前未创建的旧预览会被拒绝。提醒发送前重新核对待做数量，没有事项时取消；已经进入发送流程的消息不支持撤回。

## 文件映射

| 范围 | 文件 | 改动 |
| --- | --- | --- |
| 领域 | `miniprogram/core/habits.js` | 精确删除目标及其记录，匹配习惯版本 |
| 云协议 | `server/protocol.js` | 命令字段白名单、版本校验 |
| 云事务 | `server/cloudbase-repository.js` | 账户删除与目标置顶清理原子提交 |
| 偏好校验 | `server/preferences.js`、`server/features.js` | 提取并复用原偏好校验，保留现有 features 行为 |
| 页面 | `miniprogram/pages/detail/index.js`、`index.wxml`、`index.wxss` | 删除入口、确认锁、访问隔离、成功与失败出口 |
| 会话 | `miniprogram/services/cloud-session.js`、`workspace-store.js`、`ui.js` | 合法回执通知、原上下文草稿清理、删除进行中文案 |
| 构建 | `scripts/build-cloud.cjs` | 纳入公共偏好模块 |
| 测试 | `tests/habit-deletion.test.cjs`、`habit-deletion-pages.test.cjs`、`sdk.test.cjs` | 删除、账户隔离、真实 SDK 合同、页面和关联功能回归 |
| 文档 | `README.md`、本记录、`openspec/changes/allow-delete-habit/` | 使用说明、验证与待验收范围 |

本变更的生成文件清单如下，均来自 `npm run build:cloud`：

- `cloudfunctions/jiancheng_daka_api/`：`lib/cloudbase-repository.js`、`lib/preferences.js`、`lib/protocol.js`、`shared/habits.js`。
- `cloudfunctions/jiancheng_daka_features/`、`jiancheng_daka_public_share/`、`jiancheng_daka_reminder_tick/` 各包含：`lib/cloudbase-repository.js`、`lib/features.js`、`lib/preferences.js`、`lib/protocol.js`、`shared/habits.js`。

构建同时保留当前工作区已有的 AI/助手移除和其他改动。既有 `limits.js`、入口、plan 停用及依赖清理等差异属于实施前工作区内容；交付本功能不将这些差异算作删除功能的实现。

## 本地验证

| 命令/检查 | 结果 | 退出码 |
| --- | --- | --- |
| 删除、云 API 与 SDK 定向测试 | 41/41 通过 | 0 |
| 补充后删除页面测试 | 11/11 通过 | 0 |
| 最终 `npm test` | 429/429 通过；0 跳过 | 0 |
| `npm run check` | 343 项通过 | 0 |
| `npm run build:cloud` | 52 个生成文件 | 0 |
| `npm run check:cloud` | 52 个文件与源码一致 | 0 |
| `npm run openspec -- validate --all --strict` | 20 个变更通过 | 0 |
| `node scripts/check-native.cjs "E:\weixinDevTool\微信web开发者工具"` | wcc、wcsc 各编译 15 个输入 | 0 |
| `git diff --check` | 无差异格式错误；仅现有换行转换提示 | 0 |

SDK 合同使用已安装的锁定 `wx-server-sdk`，仅模拟底层数据库请求并禁止网络；验证偏好读取、偏好写入、账户写入和提交失败时整体回滚，事务冲突重试、偏好代际/主题错误、版本溢出、缺失偏好、其他置顶及删除重放。页面测试使用实际 cloud session、workspace store 与 note drafts，覆盖未知结果重试、无效回执、断网、账户切换、离页重入、导航失败，以及今日、进度、管理和最后一项空态。

隔离微信工具工程位于被 Git 忽略的 `qa/local/habit-deletion/`，复制当前小程序页面，启动代码仅使用内存夹具，不初始化云服务或本机持久存储。工具能启动夹具，但返回空页面列表和 `getPageMetaByWebviewId(...)` 为 null；截图请求超时，未取得有效模拟器截图。[操作结果](audits/2026-10-10-habit-deletion/observations.json) 保留失败证据。原生编译通过不代表模拟器、真机或生产验收通过。

## 待执行与回滚

未部署云函数、未删除真实账户数据，未完成双账户/双设备和真机验收。未提交、推送、归档或合并 `main`；实施前用户未提交内容保留。

实际使用前须单独授权部署测试环境 `jiancheng_daka_api` 的当前产物，核验其对账户和偏好集合的事务权限，再验收客户端。公共生成模块同步影响另外三个业务函数，是否同步部署及各目标版本须在部署阶段明确；不修改共享环境其他小程序资源或认证配置。

回滚先撤回客户端删除入口，按本记录文件映射逐块回退本次源码，保留实施前用户改动，再运行 `npm run build:cloud` 和常规验证。若已经部署，云代码回退须单独执行。代码回退不能恢复已经删除的习惯、记录或草稿，不自动回灌历史快照。
