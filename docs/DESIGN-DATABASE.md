# 渐成习惯打卡 · 数据库设计

> 配套：[概设](DESIGN-CONCEPT.md) · [详设](DESIGN-DETAIL.md) · [原型图](DESIGN-PROTOTYPE.md) · [云函数设计](DESIGN-CLOUD.md)
> 2026-09-28 复核。字段以源码为准。增量与实施增补见 [FEATURE-DATABASE-20260924.md](FEATURE-DATABASE-20260924.md)。

## 1. 集合总表

主账户一集合，其余为**旁路集合**（偏好/分享/限流/提醒/AI），均以 `jiancheng_daka_` 开头，客户端**不可直接读写**，仅本项目专属云函数服务端访问。旁路集合不改变主账户 `state` 结构、700 KiB 上限与备份格式。

| 集合 | 文档粒度／主键 | 用途 | 读写入口 | 状态 |
| --- | --- | --- | --- | --- |
| `jiancheng_daka_accounts` | 每账户一份，`_id=SHA256(APPID:OPENID)` | 习惯、打卡、epoch、修订与回执 | `jiancheng_daka_api` | 已建立 |
| `jiancheng_daka_preferences` | 每账户最多一份，`_id=owner` | 置顶习惯、默认提醒时段、分享索引与配额 | `jiancheng_daka_features` | 已建立（空） |
| `jiancheng_daka_shares` | 每份分享一文档，`_id=64位十六进制` | 公开脱敏快照、本人列表、撤回与到期 | features（写）/ public_share（只读） | 已建立（空） |
| `jiancheng_daka_limits` | 固定作用域或 作用域+owner | 分钟/日固定窗口限流计数 | 各认证/公开函数 | 已建立（空） |
| `jiancheng_daka_reminders` | 每 owner＋业务日期一文档 | 一次性订阅机会对应的聚合提醒状态 | features / reminder_tick | 已建立（空） |
| `jiancheng_daka_ai_requests` | 每账户一份，`_id=owner` | AI 请求幂等回执与当天次数 | `jiancheng_daka_plan` | 已建立（空） |
| `jiancheng_daka_ai_budget` | 全局一份，`_id=global` | 日/月预留成本（不含用户 ID） | `jiancheng_daka_plan` | 已建立（空） |

不新增反馈集合；意见反馈交给微信原生 `open-type="feedback"`。不建浏览者身份、朋友圈好友或分享奖励表。集合建立、权限、TTL 与索引须在部署检查点明确授权，不因文档存在就远端创建。

## 2. 主账户 `jiancheng_daka_accounts`

- 集合：`jiancheng_daka_accounts`（每账户一份文档）。
- 文档 ID：`owner = SHA256(APPID + ':' + OPENID)`。
- 客户端**不可直接读写**，仅云函数通过事务访问；缺失/权限错误/故障一律 fail-closed，绝不生成空替代账户。

### 2.1 ER 图

```mermaid
erDiagram
    ACCOUNT ||--o{ HABIT : "state.habits"
    ACCOUNT ||--o{ RECEIPT : "receipts"
    HABIT ||--o{ VERSION : "versions"
    HABIT ||--o{ RECORD : "records[id@date]"
    ACCOUNT {
        string owner PK "SHA256(APPID:OPENID)"
        string epoch "数据代际"
        int revision "账户版本"
        string updatedAt "ISO-8601"
    }
    HABIT {
        string id PK "客户端稳定ID"
        string createdDate "YYYY-MM-DD"
        int revision "习惯版本"
    }
    VERSION {
        string title "1-20字"
        int target "原目标"
        int minimum "忙时小目标可空"
        string unit "分钟/页/次"
        string weekdays "1-7集合"
        string time "HH:mm可空"
        string effectiveDate "次日生效"
        string status "active/paused/archived"
        int revision "版本号"
    }
    RECORD {
        string id PK "habitId"
        string date PK "YYYY-MM-DD"
        int versionRevision "绑定生效版本"
        int todayTarget "当天目标"
        string status "pending/standard/minimum"
        string note "<=280字"
        string lastSyncedAt "审计字段"
        bool delayedSync "延迟补同步"
    }
    RECEIPT {
        string id PK "operationId"
        string fingerprint "sha256(canonical)"
        int revision "appliedRevision"
    }
```

### 2.2 账户文档结构

```js
account = {
  epoch: "<uuid>",                 // 数据代际，删除/重建后更换
  revision: <int>,                 // 账户版本，每次写入 +1
  cleanupPending: false,           // 删除两段式：立即封锁后置 true
  state: {
    schemaVersion: 1,
    revision: <int>,
    habits: [ Habit ],             // 习惯数组（含版本链）
    records: { "<id>@<date>": Record },  // 打卡记录，键 = 习惯ID@日期
    settings: { hideQuote: false }
  },
  receipts: [ Receipt ],           // 操作回执（幂等），最多 256 条
  updatedAt: "<ISO-8601>"
}
```

### 2.3 实体字段

**Habit**：`{ id, createdDate, revision, versions: [ Version ] }`

**Version**：

```js
{
  title, target, minimum, unit,
  weekdays: [1..7],       // 1=周一 … 7=周日，已排序去重
  time: "HH:mm" | "",     // 仅排序，不发提醒
  effectiveDate, status, revision
}
```

**Record**（键 `"<id>@<date>"`）：`{ id, date, versionRevision, todayTarget, status, note, lastSyncedAt, delayedSync }`，`status ∈ pending|standard|minimum`，`note ≤280` 字符（服务端白名单上限）。

**Receipt**：`{ id, fingerprint, revision }`

### 2.4 约束与校验

- `validateState` 保证：habits/records 键一致、versionRevision 匹配、状态与目标数值自洽（`standard` 要求 `todayTarget === version.target`；`minimum` 要求 `todayTarget < version.target`）。
- `completeMinimum` 由服务端从当前生效版本读取 `minimum`，不接受客户端目标值。
- 写事务：账户状态与回执**同事务提交**（cloudbase-repository.js）；`saved` 未变化则不写回。
- 幂等：相同 operationId + 相同内容重试返回原回执；回执淘汰后旧请求仍受版本比较与 epoch 保护。

## 3. 偏好 `jiancheng_daka_preferences`

```js
{
  _id: "<owner-hash>",            // 服务端派生，与 account 文档 ID 一致
  schemaVersion: 1,
  ownerEpoch: "<account-epoch>",  // 删除账户后旧偏好不复活
  revision: <int>,                // 偏好独立乐观锁（CAS）
  pinnedHabitId: null,            // 或当前账户习惯 ID；最多一个
  reminderSlot: null,             // 或 "08:00" | "12:30" | "20:30"，北京时间
  shareIndex: [ ... ],            // 仅服务端可见，最多 200 条，本人分享分页游标依据
  dailyCreates: { ... },          // 当天最多 10 个 ID/指纹
  preferenceReceipts: [ ... ],    // 最多 64 条
  updatedAt: "<UTC ISO-8601>"
}
```

- `getPreferences` 先校验账号存在且 `ownerEpoch === account.epoch`；未建文档返回默认值，不把**集合不存在/权限错误/服务故障**误当"用户未设置"。
- `setPreferences({operationId, expectedRevision, patch})` 只接受白名单字段，按修订号 CAS。
- `reminderSlot` 只是下次申请的默认选择，**不等于**订阅同意或已安排通知。
- 事务仅点读写本文档；索引为每 owner 串行化配额与分页提供依据，不依赖事务内范围查询。

## 4. 公开快照 `jiancheng_daka_shares`

```js
{
  _id: "<64-lower-hex-share-id>",
  schemaVersion: 1,
  owner: "<owner-hash>",          // 私有，永不返回给访客
  ownerEpoch: "<account-epoch>",
  requestId: "<client-idempotency-id>", // 客户端安全随机，64 位十六进制
  kind: "invite" | "plan" | "weekly",
  status: "active" | "revoked",
  createdAt: "<UTC ISO-8601>",
  expiresAt: "<UTC ISO-8601>",    // 创建后 90 天；公开读取时实时比较
  revokedAt: null,
  sourceRevision: <int>,          // 创建时账户修订，仅内部核对
  publicSnapshot: { ... }         // 下列严格判别联合之一
}
```

`shareId = SHA256(owner + ':' + epoch + ':' + requestId)`；同一用户同一请求重试获得同一 ID，客户端不能指定最终 ID。不用顺序号、时间戳或 `habitId` 作为公开 ID。

### 4.1 `publicSnapshot` 白名单

```js
// invite
{ kind: "invite", coverKey: "default", templateKeys: ["read", "walk", "study"] }

// plan
{ kind: "plan", categoryKey: "read", target: 10, minimum: 2,
  unit: "分钟", weekdays: [1, 3, 5] /* 用户选择公开时才有此字段 */ }

// weekly：已结束的连续 7 个自然日，不含今天
{ kind: "weekly", startDate: "2026-09-16", endDate: "2026-09-22",
  planned: 9, standard: 4, minimum: 2, captionKey: "small-steps" }
```

`categoryKey/coverKey/templateKeys/captionKey` 取服务端固定枚举；客户端不能送自填标题或图片 URL。`plan` 的 `target/minimum/unit` 来自当前生效版本；`weekly` 数字由服务端聚合。不存手机号、昵称、头像、具体打卡日期、笔记或浏览者 ID。单份公开响应建议 ≤2 KiB。

### 4.2 读取、撤回与保留

- `getPublicShare(shareId)` 仅精确文档 ID 查询；存在、未到期且 `status=active` 后，还须读 owner **当前账户 epoch**，相等才返回。账户不存在、epoch 不同、撤回/到期、读库错误一律 fail-closed，返回统一"分享不可用"。
- `listMyShares` 限定 owner，按 `createdAt` 倒序、每页最多 20 条，用 `shareIndex` 末条 ID 作游标；`getMyShare` 为受认证点读，可回看撤回或到期快照。
- `revokeShare` 幂等写 `revokedAt`；`deleteShare` 先使公开访问失效再物理删除。
- 上限：每人 50 份有效、200 份总历史、每日新建最多 10 份。达到上限明确提示整理，不静默覆盖。

## 5. 限流 `jiancheng_daka_limits`

```js
// 全局文档：_id = "global-" + scope
{ schemaVersion: 1, minute: <epoch分钟>, day: <北京日序>, minuteUsed: <int>, dayUsed: <int> }
// 私有文档：_id = scope + "-" + owner
{ ..., owner: "<owner-hash>", ownerEpoch: "<account-epoch>" }
```

- `scope ∈ features | public | reminders | ai | reminder-send`；`features/reminders/ai` 为私有作用域（需 owner+epoch），`public` 无身份。
- 固定窗口：分钟窗口 + 北京日窗口；事务内原子核减；**不回退**（旧时钟回退的文档按故障处理）。
- 私有计数先读账户 `epoch` 与 `cleanupPending`，删除后迟到请求不重建旧文档。
- 全局计数**不含用户标识**；函数实例内短暂缓存已耗尽结果以减少重复查库。
- 该限流只约束下游业务请求，不能保证总云账单；平台配额/费用告警为独立门禁。

## 6. 一次性提醒 `jiancheng_daka_reminders`

```js
{
  _id: "<sha256(owner:ownerEpoch:businessDate)>",
  schemaVersion: 1,
  owner: "<owner-hash>",
  ownerEpoch: "<account-epoch>",
  businessDate: "2026-09-25",     // 北京时间 YYYY-MM-DD
  slot: "20:30",                  // 三个固定时段之一
  dueAt: "<UTC ISO-8601>",
  templateId: "<server-config>",  // 预览时返回前端申请订阅
  recipient: { iv, data, tag },   // AES-GCM 加密 OpenID；终态清除
  generation: <int>,              // 同日取消后重新授权再安排时递增，上限 8
  status: "pending" | "claimed" | "sent" | "cancelled" | "failed" | "unknown",
  receipts: [ ... ],              // 最多 8 个 operationId/指纹
  claimId: null,
  claimedAt: null,
  expiresAt: <Date>,              // TTL：dueAt 后 14 天
  updatedAt: "<UTC ISO-8601>"
}
```

状态机与防重复：

```text
无记录 --用户点击且平台授权回 accept--> pending
pending --用户取消/当天全部完成/账户删除--> cancelled
pending --到期事务认领--> claimed
claimed --平台明确接受发送请求--> sent
claimed --明确不可重试错误--> failed
claimed --超时或结果不明--> unknown
```

`claimed/sent/failed/unknown` 不自动回到 `pending`；重复触发时只有一个执行者能以事务把 `pending` 改为 `claimed`。调用超时标 `unknown`，不盲目重发。不落原始 OpenID，不保存原始平台响应。TTL 到期执行存在平台延迟。

## 7. AI `jiancheng_daka_ai_requests` 与 `jiancheng_daka_ai_budget`

```js
// ai_requests：_id = owner
{ owner, ownerEpoch, day, dayCount,
  receipts: [ { id, fingerprint, day, status, startedAt, selection } ] } // 最多 32 条

// ai_budget：_id = "global"
{ schemaVersion, day, dayReserved, month, monthReserved }  // 单位：百万分之一元
```

- 只存幂等回执与预留额，**不存**原始输入、模型响应或密钥；模型返回的任意文本不落库、不回前端。
- 先事务预留，再调用模型；同 operationId/指纹只付费尝试一次，成功重复返回同结果，`pending/unknown` 不再调用；失败和超时不退还预留。
- 全局预算**不含用户 ID**；主账户删除清理本人 AI 回执，不退还已预留的全局额度。
- 金额单位是百万分之一元（`HABIT_AI_*_MICRO_CNY`），**不是** token。

## 8. 索引、权限与容量

| 集合 | 必要索引／访问模式 | 边界 |
| --- | --- | --- |
| accounts | 已有文档 `_id`；删除清理标记的受控扫描索引需验证平台支持 | 700 KiB、256 回执 |
| preferences | `_id=owner` | 1 文档/账户；`shareIndex`≤200、`dailyCreates`≤10/日、回执≤64 |
| shares | `_id` 公共精确读取；`owner + createdAt DESC` 本人分页 | 50 有效/人、200 总/人、10 创建/日；公开响应≤2 KiB |
| limits | `_id` 点读写（全局 + 每 owner） | 每分钟/每日固定窗口 |
| reminders | `_id` 防同日重复；`status + dueAt` 到期批量查询 | 每人每日≤1；TTL 14 天 |
| ai_requests / ai_budget | `_id` 点读写 | 回执≤32；日/月预留上限 |

- 云函数按文档 ID 读写；主账户为单文档模型，无业务二级索引需求。
- 权限规则：客户端不可直接读写任一集合；仅允许 `wx_client` / `wx_devtools` 来源的可信调用（公开入口按 `shareId` 只读白名单）。
- 函数级开关见[云函数设计](DESIGN-CLOUD.md)。
- 上述索引为**所需设计**；正式云创建/权限/TTL 状态见[剩余交付跟踪](REMAINING-DELIVERY-20260927.md)（七集合与四个普通业务索引已核验；权限/TTL 待核验）。

## 9. 删除、恢复与迁移边界

个人数据删除扩为**两段式**（`purge`）：

1. **立即封锁**：主账户事务换 epoch、清空主数据，并在最小删除回执中标记 `cleanupPending=true`。公开分享读取与提醒发送每次均检查 `ownerEpoch`；提交后新发起的旧分享读取与待发提醒被拒绝。
2. **物理清理**：按 owner 分批删 preferences、shares、limits、reminders、ai_requests；全部成功才将 `cleanupPending=false` 并向客户端确认。失败返回"删除处理中，请重试"，客户端保留待确认删除操作与本机恢复材料；同一删除 operationId 重放须继续清理，不能沿用"发现回执立即成功"的捷径。

其他边界：

- 主账户 `state.schemaVersion=1` 不变；旁路集合从空开始，不搬旧测试云或本机开发记录。
- 已有开发期本机记录不会自动上传/合并，只能从备份页单独导出。
- 删除后云端保留最小元数据（账户键、递增版本、新 epoch、更新时间、删除回执）用于阻止旧设备回传；不储存公开内容。
- 账号重建（新 epoch）不得重新认领旧偏好或旧分享。
- B021 起新部署用 `jiancheng_daka_` 前缀；旧测试云 `habitApi`、旧数据与旧缓存保留，**不自动迁移**。
