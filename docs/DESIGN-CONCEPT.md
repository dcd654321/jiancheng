# 渐成习惯打卡 · 概设（概念设计）

> 配套：[详设](DESIGN-DETAIL.md) · [原型图](DESIGN-PROTOTYPE.md) · [数据库设计](DESIGN-DATABASE.md) · [云函数设计](DESIGN-CLOUD.md)
> 整理自源码与协议，2026-09-28 复核。以代码为准，历史原型与营销口号仅作参考。
> 文中「已实现」指代码与自动测试已落地；「默认关闭」指客户端开关或服务端门禁为关，**不等于已验收可用**。真实云、平台与真机验收状态见 [剩余交付跟踪](REMAINING-DELIVERY-20260927.md)。

## 1. 产品定位

「渐成习惯打卡」是一款面向**个人用户**的轻量习惯养成工具，用**原生微信小程序**实现（非网页包装、非 Taro/uni-app）。核心价值是低门槛记录"今天做没做"：**创建习惯 → 每天打卡 → 看进度 → 留一句备注**。

刻意不做的部分：无积分/奖励/勋章、无三阶段长期计划、无内容流与营销页、无好友社交关系与排行、无分享奖励。目标收敛为"帮一个人坚持每天的一小步"。

## 2. 目标用户与场景

- 想养成某个小习惯、但缺记录动力的个人。
- 弱网/断网时也能看今天要做的事，恢复网络后自动补传。
- 换机后凭同一微信账号找回已同步记录。
- 忙时目标与"今天少做一点"：让状态差的一天也保留连续性，而不是非全即零。
- （后续增强）把一条真实习惯做成可分享的公开快照，或按计划日申请一次聚合提醒。

## 3. 核心功能

| 模块 | 能力 | 状态 |
| --- | --- | --- |
| 今日 | 日期 + 添加入口、待做/已做进度、逐项打卡/撤销、原位短时撤销、明天安排、"今天少做一点"、回归提示、首次使用下一步引导 | 可用（客户端） |
| 习惯 | 创建（名称/目标/忙时小目标/星期）、编辑/暂停/恢复/归档（次日生效）、详情备注与历史 | 可用（客户端） |
| 进度 | 近 7/28 天统计、日历视图、按日明细、按习惯汇总 | 可用（客户端） |
| 我的 | 习惯管理、首页短句开关、数据与隐私、使用帮助、微信内置反馈 | 可用（客户端） |
| 计划助手 | 本机规则建议；联网 AI 增强（DeepSeek 适配、受限动作目录、按次/日/月预算） | 规则可用；AI **默认关闭** |
| 一起进步 · 分享 | 邀请/轻计划/一周进展三类公开快照，好友只读打开，本人回看/撤回/删除 | **默认关闭** |
| 提醒 | 我的 → 提醒，选时段后主动授权一次性聚合提醒（非每日推送） | **默认关闭** |

"分享奖励、支付、广告、发现页、内容社区"仍明确不做。

## 4. 架构总览

```mermaid
flowchart TB
    subgraph FE["小程序前端 miniprogram/"]
        direction TB
        P["pages/ 原生交互<br/>今日·进度·我的·编辑·详情·管理<br/>同步·导出找回·数据·计划助手<br/>分享创建/列表/查看·提醒"]
        S["services/ 云端主数据·确认快照·离线队列<br/>同步引擎·工作区·功能网关·回归判定"]
        CORE["core/ 纯业务规则<br/>日期·习惯状态机·统计·CSV·AI契约·分享展示"]
        P --> S --> CORE
    end
    subgraph CLOUD["微信云开发（共享环境）"]
        direction TB
        API["jiancheng_daka_api<br/>主数据同步"]
        FEAT["jiancheng_daka_features<br/>偏好·分享·提醒（私有）"]
        PUB["jiancheng_daka_public_share<br/>公开只读快照"]
        PLAN["jiancheng_daka_plan<br/>AI 计划（默认关闭）"]
        TICK["jiancheng_daka_reminder_tick<br/>定时催发提醒"]
        DB[("7 个集合<br/>accounts·preferences·shares·limits<br/>reminders·ai_requests·ai_budget")]
        API --> DB
        FEAT --> DB
        PUB --> DB
        PLAN --> DB
        TICK --> DB
    end
    S -->|"callFunction（可信身份 APPID+OPENID）"| API
    S -->|"功能网关（默认关闭）"| FEAT
    S -->|"分享链接（可免登录）"| PUB
    S -->|"AI（默认关闭）"| PLAN
    "平台定时触发" --> TICK
```

分层职责：

| 层 | 职责 | 可测试性 |
| --- | --- | --- |
| `miniprogram/core` | 纯业务规则：日期、习惯状态机、统计、CSV、AI 结果校验、分享展示模型 | Node 直接测试，无前端依赖 |
| `miniprogram/services` | 云端主数据、确认快照、持久离线队列、同步引擎、工作区、功能网关、生命周期 | 契约测试 |
| `miniprogram/pages` | 原生 WXML/WXSS/JS 交互 | 页面回归 |
| `server`（源码） | 协议白名单、可信身份校验、事务仓库、领域处理、限流与预算、提醒与 AI | 服务端协议测试 |
| `cloudfunctions/*` | 5 个云函数入口 + 构建产物（由 `scripts/build-cloud.cjs` 生成，不手工改） | 云包一致性 |

## 5. 数据权威模型

正式工作区**只有云端一种数据来源**。本机只承担三类职责：

```mermaid
flowchart LR
    CLOUD[("云端账户<br/>唯一权威数据源")]
    SNAP[("本机确认快照<br/>断网可读")]
    QUEUE[("本机待同步队列<br/>恢复自动重试")]
    CLOUD -->|"pull 确认"| SNAP
    QUEUE -->|"mutate 顺序提交"| CLOUD
```

- 用户不选择"本机/云模式"，不手动连接、断开或切换数据源。
- 首次启动先同意数据说明才联网；不同意则不联网，也不伪造可编辑空账户。
- 已有开发期本机数据不会自动上传/合并，只能从备份页单独导出。
- 旁路集合（偏好、分享、限流、提醒、AI）与主账户分离，**不改变**主账户 `state` 结构、700 KiB 上限与备份格式（详见[数据库设计](DESIGN-DATABASE.md)）。

## 6. 身份与安全

- 身份来自微信云函数的**可信上下文**（APPID + OPENID + SOURCE），客户端不得提交 userId/ownerId。
- 账户键 = `SHA256(APPID + ':' + OPENID)`，用于隔离与绑定，不是登录凭证、不是匿名化承诺。
- SOURCE 白名单仅 `wx_client` / `wx_devtools`；AppSecret 与模型密钥只放服务端环境变量，不进前端包。
- 公开分享入口是**唯一**可免登录的读取路径：仅按不可猜测的 `shareId` 返回白名单脱敏快照，不能读任何私人账户数据，也不能查询列表。
- 每个云函数有独立启用门禁（环境变量布尔值），任一缺失即返回 `NOT_ENABLED`，见[云函数设计](DESIGN-CLOUD.md)。

## 7. 资源命名

| 用途 | 名称 | 状态 |
| --- | --- | --- |
| 主数据云函数 | `jiancheng_daka_api` | 已部署 |
| 功能云函数（偏好/分享/提醒） | `jiancheng_daka_features` | 已部署，默认关闭 |
| 公开分享只读云函数 | `jiancheng_daka_public_share` | 已部署，默认关闭 |
| AI 计划云函数 | `jiancheng_daka_plan` | 已部署，默认关闭 |
| 提醒定时云函数 | `jiancheng_daka_reminder_tick` | 已部署，默认关闭 |
| 账户集合 | `jiancheng_daka_accounts` | 已建立 |
| 偏好集合 | `jiancheng_daka_preferences` | 已建立（空） |
| 分享集合 | `jiancheng_daka_shares` | 已建立（空） |
| 限流集合 | `jiancheng_daka_limits` | 已建立（空） |
| 提醒集合 | `jiancheng_daka_reminders` | 已建立（空） |
| AI 请求集合 | `jiancheng_daka_ai_requests` | 已建立（空） |
| AI 预算集合 | `jiancheng_daka_ai_budget` | 已建立（空） |

命名前缀只用于辨识资源，**不是安全边界**；访问控制依赖可信身份与数据库权限。

## 8. 技术选型

- JavaScript + JSDoc / CommonJS，开发者工具直接导入；不引入 TypeScript 编译链、无第三方前端运行依赖。
- 云函数运行时目标 Node.js 16.13.2；本地测试/检查用 Node.js 20+。
- 前端无 npm 运行依赖，无需"构建 npm"。
- `lazyCodeLoading: requiredComponents` 已开启，按需注入组件。

## 9. 当前实现状态与开关（2026-09-28）

客户端开关集中在 `miniprogram/config/`，全部**默认关闭**：

| 配置文件 | 开关 | 当前值 | 说明 |
| --- | --- | --- | --- |
| `cloud.js` | `enabled` | `true` | 活动调用指向**旧测试环境** `habitApi` |
| `cloud.product.js` | `enabled` | `false` | 共享正式环境 `product-d2g59zty74d7d1ec1`，未切换 |
| `features.js` | `enabled` / `publicShares` / `timeline` | `false` | 偏好、分享、朋友圈卡片 |
| `ai.js` | `enabled` | `false` | 联网 AI 计划 |
| `reminders.js` | `enabled` | `false` | 一次性提醒 |

已实现但**受开关/门禁关闭**的能力：偏好与置顶、分享（邀请/轻计划/周进展）、一次性提醒、AI 计划、按用户/全局限流与 AI 预算。已实现且**无需开关**的纯客户端能力：回归提示、忙时目标双档展示、原位撤销、明日安排。

关键阻塞：正式共享环境实测 `Cloud.init()` 仍返回 `errCode:403`（"当前小程序未获得云环境的共享权限"），控制台授权存在 ≠ 运行时鉴权通过，故正式配置与全部新能力保持关闭。待验收清单见文档末尾与[剩余交付跟踪](REMAINING-DELIVERY-20260927.md)。

## 10. 待验收（不在代码完成范围内）

- 共享云身份/权限：资源方 AppID、使用方来源、403 根因与真实鉴权。
- 分享：好友与朋友圈真机打开、单页模式、撤回后旧链接失效、双用户隔离。
- 提醒：本账号订阅模板资格、真实授权与送达、定时器、时区与 TTL、账单上限。
- AI：供应商/模型/价格与预算预留、隐私条款、真实建议有效性；无收益则不启用。
- 真机：Android/iOS 全流程、大字号、窄屏（320/375/430）、弱网、冷启动与后台恢复、内置反馈接收。
- 平台配额/费用告警、日志脱敏、回滚演练、隐私说明与小程序审核资料。
