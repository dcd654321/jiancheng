# 渐成习惯打卡 · 云函数设计

> 配套：[概设](DESIGN-CONCEPT.md) · [详设](DESIGN-DETAIL.md) · [数据库设计](DESIGN-DATABASE.md) · [云端主数据与离线同步](CLOUD-SYNC.md)
> 2026-09-28 复核。动作、字段与门禁以 `server/` 源码为准；部署与验收状态见[剩余交付跟踪](REMAINING-DELIVERY-20260927.md)。

## 1. 函数清单

5 个云函数，均以 `jiancheng_daka_` 开头。客户端调用前先看 `miniprogram/config/cloud-resources.js` 的名称；除公开只读与定时入口外，全部要求可信微信身份。

| 函数 | 入口源码 | 用途 | 默认状态 |
| --- | --- | --- | --- |
| `jiancheng_daka_api` | `server/handler.js` | 主数据同步（pull/mutate/purge） | 已部署；活动客户端指向旧测试 `habitApi` |
| `jiancheng_daka_features` | `server/entries/features.js` | 偏好、分享（私有）、提醒（私有） | 已部署，默认关闭 |
| `jiancheng_daka_public_share` | `server/entries/public-share.js` | 公开分享只读 | 已部署，默认关闭 |
| `jiancheng_daka_plan` | `server/entries/plan.js` | AI 计划（DeepSeek） | 已部署，默认关闭 |
| `jiancheng_daka_reminder_tick` | `server/entries/reminder-tick.js` | 定时催发一次性提醒 | 已部署，默认关闭，**未创建定时器** |

## 2. 源码与构建

`server/` 是唯一手写来源；`cloudfunctions/*` 是 `scripts/build-cloud.cjs` 生成的部署副本，**不手工修改**。改动只改 `server/` 与 `shared/`，再运行构建并 `--check` 校验一致。

| 源码模块 | 职责 |
| --- | --- |
| `server/handler.js` | 主 API：身份、版本/代际比较、幂等回执、日期窗口、reduce 应用命令、purge |
| `server/protocol.js` | 主 API 动作/字段白名单、请求大小与指纹规范、`RECORD_TYPES` |
| `server/identity.js` | 从可信上下文（APPID+OPENID+SOURCE）派生 owner |
| `server/cloudbase-repository.js` | 账户状态与回执同事务保存（`COLLECTION`） |
| `server/features.js` | 偏好 CAS、分享预览/创建/列表/点读/撤回/删除、公开白名单 |
| `server/features-repository.js` | 偏好与分享的点读写事务适配 |
| `server/limits.js` | 固定窗口限流（global + 每 owner），作用域 `features/public/reminders/ai/reminder-send` |
| `server/reminders.js` | 提醒预览/申请/读取/取消、加密收件、同日去重 |
| `server/reminder-worker.js` | 定时入口授权、事务认领、单次发送、结果状态 |
| `server/ai-plan.js` | AI 请求幂等、日/月预留预算、目录校验 |
| `server/ai-provider.js` | DeepSeek JSON 适配（固定 HTTPS 地址，不跟随重定向） |
| `server/sidecar-cleanup.js` | 删除后按 owner 分批清理旁路集合 |
| `server/entries/*.js` | 各函数的 `exports.main` 入口与环境门禁 |

## 3. 主 API `jiancheng_daka_api`

### 3.1 动作

| action | 输入 | 说明 |
| --- | --- | --- |
| `pull` | 仅 `action` | 读取当前微信账户快照，不接受身份或筛选字段 |
| `mutate` | `operationId, epoch, expectedRevision, operationDate, command` | 白名单命令写入（见[详设 §3](DESIGN-DETAIL.md)） |
| `purge` | `operationId, epoch, expectedRevision, operationDate, confirmation=DELETE_MY_DATA` | 删除个人数据（两段式，见 §6） |

### 3.2 门禁

`HABIT_APP_ID` + `HABIT_MINIPROGRAM_ONLY=true` + `HABIT_API_ENABLED=true`，否则返回 `NOT_ENABLED`。SOURCE 白名单仅 `wx_client` / `wx_devtools`。

### 3.3 处理顺序

身份校验 → 请求体 ≤4096 字节 + 字段白名单 → 回执查重（同 ID 同指纹返回原回执，同 ID 换内容拒绝）→ 版本/代际比较（`EPOCH_CHANGED` / `CONFLICT`）→ 日期门禁（当天记录可补最近 6 天，计划修改须当天）→ 事务 `reduce` + 校验 + revision+1 → 写回账户与回执。

## 4. 功能函数 `jiancheng_daka_features`

### 4.1 动作（私有，均需受信身份 + `epoch`）

| action | 最小字段 | 说明 |
| --- | --- | --- |
| `getPreferences` | — | 读取本人偏好（默认值或当前值 + revision） |
| `setPreferences` | `operationId, expectedRevision, patch` | 白名单字段 CAS 更新（置顶、默认提醒时段） |
| `previewShare` | `kind, sourceHabitId?, categoryKey?, includeWeekdays?, captionKey?` | 服务端生成预览（返回 `requestId`、`sourceRevision`） |
| `createShare` | 预览字段 + `requestId, requestDate, sourceRevision` | 幂等创建公开快照 |
| `listMyShares` | `cursor?` | 本人分享分页（≤20/页） |
| `getMyShare` | `shareId` | 受认证点读（含撤回/到期） |
| `revokeShare` / `deleteShare` | `shareId` | 撤回 / 物理删除 |

### 4.2 提醒动作（同函数路由，额外门禁）

| action | 字段 | 说明 |
| --- | --- | --- |
| `previewReminder` | `slot` | 返回 `slot/businessDate/dueAt/sourceRevision/generation/operationId/templateId` |
| `scheduleReminder` | `slot, businessDate, dueAt, sourceRevision, generation, operationId, subscriptionResult='accept'` | 记录一次性待发，拒绝陈旧版本 |
| `getReminders` | — | 点读昨日至未来六日共 8 条 |
| `cancelReminder` | `businessDate, generation` | 取消当天待发 |

提醒请求体 ≤2048 字节。

### 4.3 门禁

基础门禁：`HABIT_FEATURES_ENABLED`、`HABIT_IDENTITY_VERIFIED`、`HABIT_SIDECAR_CLEANUP_ENABLED`、`HABIT_LIMITS_VERIFIED`、`HABIT_MINIPROGRAM_ONLY`、`HABIT_APP_ID`。
提醒动作**另需**：`HABIT_REMINDERS_ENABLED`、`HABIT_REMINDER_STORAGE_READY`、`HABIT_TEMPLATE_VERIFIED`、`HABIT_TIMER_VERIFIED`、`HABIT_REMINDER_TTL_VERIFIED`，并配置 `HABIT_REMINDER_KEY`（AES-GCM 密钥）、`HABIT_REMINDER_TEMPLATE`。

## 5. 公开分享 `jiancheng_daka_public_share`

| action | 字段 | 说明 |
| --- | --- | --- |
| `getPublicShare` | `shareId` | 唯一动作；精确 ID + 状态/epoch 门禁，返回白名单快照或统一 `SHARE_UNAVAILABLE` |

门禁：`HABIT_PUBLIC_SHARES_ENABLED`、`HABIT_SIDECAR_CLEANUP_ENABLED`、`HABIT_LIMITS_VERIFIED`。此入口**不**要求个人登录，也**不得**路由到私有账户 API；只读一份脱敏快照，不返回 `owner`、`ownerEpoch`、`requestId`、备注或 OpenID。

## 6. AI 计划 `jiancheng_daka_plan`

| action | 字段 | 说明 |
| --- | --- | --- |
| `suggest` | `action='suggest', epoch, operationId, operationDate, input{direction, minutes, weekdays?, time?}, consent=true` | 受限目录内返回 `actionKey/reasonKey/target/minimum` |

门禁：`HABIT_AI_ENABLED`、`HABIT_AI_STORAGE_READY`、`HABIT_AI_BUDGET_VERIFIED`、`HABIT_AI_CATALOG_VERIFIED`、`HABIT_IDENTITY_VERIFIED`、`HABIT_MINIPROGRAM_ONLY`、`HABIT_LIMITS_VERIFIED`、`HABIT_SIDECAR_CLEANUP_ENABLED`、`HABIT_APP_ID`，且 `HABIT_AI_PROVIDER=deepseek`。

配置（密钥只放服务端）：`HABIT_AI_API_KEY`、`HABIT_AI_MODEL`、`HABIT_AI_USER_DAILY`、`HABIT_AI_RESERVATION_MICRO_CNY`、`HABIT_AI_DAY_MICRO_CNY`、`HABIT_AI_MONTH_MICRO_CNY`、`HABIT_AI_LIMIT_*`。生成参数：非流式 JSON、关思考、≤512 输出 token、HTTP ≤8s、响应 ≤32 KiB、正文 ≤1 KiB。详见 [AI 启用清单](AI-DEPLOYMENT-20260927.md)。

先事务预留，再调用模型；同 operationId/指纹只付费一次；失败/超时不退还预留、不重试。模型不可用时回退到本机规则建议。

## 7. 定时催发 `jiancheng_daka_reminder_tick`

无私有动作；仅由平台定时器调用（`authorizeTimer` 校验 `HABIT_TIMER_SECRET` 与 `HABIT_TIMER_NAME`）。流程：查询该时段到期记录 → 事务认领（`pending`→`claimed`）→ 重读当前账户状态 → 平台接口**最多发送一次** → 写结果（`sent`/`failed`/`unknown`）。发送前复核 owner 当前 epoch、业务日、当日未完成数；任一失败则取消而非发送。

门禁：`HABIT_REMINDERS_ENABLED`、`HABIT_REMINDER_STORAGE_READY`、`HABIT_TIMER_VERIFIED`、`HABIT_TEMPLATE_VERIFIED`、`HABIT_REMINDER_TTL_VERIFIED`、`HABIT_LIMITS_VERIFIED`、`HABIT_IDENTITY_VERIFIED`、`HABIT_SIDECAR_CLEANUP_ENABLED`。使用 `HABIT_SEND_LIMIT_*` 限流、`HABIT_REMINDER_KEY` 解密、`HABIT_MESSAGE_STATE` 指定消息状态。

## 8. 删除联动（两段式）

`purge` 在主账户事务内换 epoch、清空主数据并置 `cleanupPending=true`；随后 `sidecar-cleanup` 按 owner 分批物理删除 preferences、shares、limits、reminders、ai_requests。全部成功才置 `cleanupPending=false` 并回执成功；失败返回"删除处理中"，同 operationId 重放须继续清理。公开分享读取与提醒发送每次检查 `ownerEpoch`，删除后新请求被拒。主 API 需保持 `HABIT_REMINDER_STORAGE_READY=true`（及 AI 的 `HABIT_AI_STORAGE_READY`）直到清理完成，**产品停用不能关闭清理**。

## 9. 部署与验证状态（2026-09-28）

- 5 个函数在共享正式环境 `product-d2g59zty74d7d1ec1` 均为 Active；`jiancheng_daka_api` 另保留平台版本 `1` 作为回滚材料（尚未演练回滚）。
- `jiancheng_daka_features` 旧部署任务丢失、代码版本与调用待验证。
- 客户端活动配置仍指向旧测试环境 `habitApi`（`config/cloud.js`），共享正式环境 `config/cloud.product.js` 为 `enabled:false`。
- 正式共享连接阻塞：`Cloud.init()` 实测返回 `errCode:403`（"当前小程序未获得共享权限"）；控制台授权存在 ≠ 运行时鉴权通过。
- 未创建任何定时器、未发送消息、未调用 AI 模型；新能力均未启用。

具体动作、门禁与恢复边界见 [DEPLOYMENT-STAGING-20260927.md](DEPLOYMENT-STAGING-20260927.md)、[NATIVE-CLOUD-PREFLIGHT-20260927.md](NATIVE-CLOUD-PREFLIGHT-20260927.md)。
