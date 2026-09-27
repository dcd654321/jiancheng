# 渐成习惯打卡：多任务、提醒、分享增量数据库设计

日期：2026-09-24　状态：待实施设计。配套：[功能详设](FEATURE-DESIGN-20260924.md) · [现有主数据设计](DESIGN-DATABASE.md)

## 1. 设计原则及数据边界

本设计以当前源码为基线，不把规划字段写成已部署事实。现有 `jiancheng_daka_accounts` 每人一份文档，`_id=SHA256(APPID:OPENID)`，文档 `payload` 包含 `epoch/revision/state/receipts/updatedAt`；`state.schemaVersion=1`，习惯与记录的有效数据仍由现有 `habits.js` 校验。账户及幂等回执同事务写入。正式共享云配置仍关闭，不能把旧测试云的 `habitApi` 或其他小程序集合当成新功能的数据源。

新增数据采取**旁路集合**：置顶及提醒时段是私有偏好；分享是可撤销的公开快照；提醒是一次性发送任务。主账户结构、700 KiB 上限、既有离线队列和个人备份格式均不变。所有新集合以 `jiancheng_daka_` 开头，客户端无直接集合读写权限；认证函数从可信平台上下文派生 owner，绝不使用客户端提交的 AppID、OpenID、owner 作为身份。只有受限公开读取入口可不要求个人登录，且只读一份脱敏分享快照。

## 2. 集合总表

| 集合 | 文档粒度／主键 | 用途 | 读写入口 |
| --- | --- | --- | --- |
| `jiancheng_daka_accounts`（已有） | 每账户一份，哈希 owner | 习惯、打卡、epoch、修订与回执 | 现有 `jiancheng_daka_api`；新函数仅在已验证身份后读权威快照 |
| `jiancheng_daka_preferences`（新增） | 每账户最多一份，`_id=owner` | 置顶习惯和默认提醒时段，不代表消息授权 | 仅认证功能函数 |
| `jiancheng_daka_shares`（新增） | 每份分享一文档，随机性 ID | 本人分享列表、公开脱敏快照、撤回与到期 | 认证功能函数；公开函数只能按 ID 读白名单字段 |
| `jiancheng_daka_reminders`（新增，条件实施） | 每 owner＋业务日期最多一文档 | 一次性订阅机会对应的聚合提醒状态 | 认证功能函数＋平台定时函数 |

不新增反馈集合；现有 `open-type="feedback"` 交给微信原生反馈。也不建浏览者身份、朋友圈好友或分享奖励表。集合建立、权限、索引及触发器都须在部署检查点明确授权，不能因文档存在就远端创建。

## 3. 私有偏好 `jiancheng_daka_preferences`

```js
{
  _id: "<owner-hash>",            // 与 account 文档 ID 一致，服务端派生
  schemaVersion: 1,
  ownerEpoch: "<account-epoch>",  // 删除账户后旧偏好不复活
  revision: 1,                    // 偏好独立乐观锁
  pinnedHabitId: null,            // 或当前账户习惯 ID；最多一个
  reminderSlot: null,             // 或 "08:00" | "12:30" | "20:30"，北京时间
  updatedAt: "<UTC ISO-8601>"
}
```

`getPreferences` 先校验账号存在且 `ownerEpoch===account.epoch`；未建偏好文档时返回默认值，不应把**集合不存在／权限错误／服务故障**误当「用户未设置」。`setPreferences({operationId,expectedRevision,patch})` 只接受白名单字段，按修订号 CAS，返回新修订。置顶目标必须属于该 owner 现有习惯；若随后归档、暂停或今天休息，今日页忽略置顶，不因此修改打卡记录。`reminderSlot` 只是下一次申请时的默认选择，**不等于订阅同意或已安排通知**。

偏好默认值可在客户端短时缓存作只读显示，但云端是权威来源；离线时不能宣称新置顶／新时段已保存。每个会话至多拉一次偏好，再按显式变更刷新，避免每打开一张任务卡都读数据库。

## 4. 公开快照 `jiancheng_daka_shares`

### 4.1 文档结构

```js
{
  _id: "<64-lower-hex-share-id>",
  schemaVersion: 1,
  owner: "<owner-hash>",          // 私有，永不返回给访客
  ownerEpoch: "<account-epoch>",
  requestId: "<client-idempotency-id>",
  kind: "invite" | "plan" | "weekly",
  status: "active" | "revoked",
  createdAt: "<UTC ISO-8601>",
  expiresAt: "<UTC ISO-8601>",   // 创建后 90 天；公开读取时实时比较
  revokedAt: null,
  sourceRevision: 12,             // 创建时账户修订，仅内部核对
  publicSnapshot: { /* 下列严格判别联合之一 */ }
}
```

`shareId` 由服务端按 `SHA256(owner + ':' + requestId)` 得出；`requestId` 必须是前端安全随机生成的高熵操作号，同一用户同一请求重试获得同一 ID，客户端不能指定最终 ID。不要把顺序号、时间戳或 `habitId` 直接作为公开 ID。创建时还要校验同 ID 的既有请求内容指纹：相同返回既有快照，不同拒绝。若目标运行环境无法提供足够随机的请求号，则改由服务端随机 ID 加唯一请求索引，先验证索引语义后实现。

`sourceRevision`、`ownerEpoch`、`owner`、`requestId` 和状态只供服务端使用，公开接口不返回。服务端从云端主账户读取真实数据生成快照，**不接受客户端上传的完成次数、私人习惯名、备注、OpenID 或任意正文**。

### 4.2 `publicSnapshot` 白名单

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

示例数字只是结构样例，不代表真实用户。`categoryKey/coverKey/templateKeys/captionKey` 取服务端固定枚举；客户端不能送自填标题或图片 URL。`plan` 的 `target/minimum/unit` 必须来自当前生效版本，且 `minimum` 合法存在；`weekly` 的数字由服务端聚合，`standard + minimum <= planned`。快照按发布时固定，后续习惯编辑不会悄悄改写已分享内容。单份公开响应建议限制在 2 KiB 内；不存手机号、昵称、头像、具体打卡日期、笔记或浏览者 ID。

### 4.3 读取、撤回和保留

`getPublicShare(shareId)` 只允许精确文档 ID 查询；存在、未到期且 `status=active` 后，还必须读 owner 的**当前账户 epoch**，相等才返回 `{kind, publicSnapshot, expiresAt}`。账户不存在、epoch 不同、记录撤回／到期、读库错误时均 fail-closed，向访客返回同一「分享不可用」结果。普通用户分享页不要求先同意其**个人数据存储**，但公开入口不得因此获得私人账户读取权限。

`listMyShares` 限定 owner，按 `createdAt` 倒序、每页最多 20 条；返回本人可见状态及快照，不返回其他人的记录。列表上的「已到期」由 `expiresAt` 派生，不额外存入 `status`。`revokeShare` 只允许 owner 操作，幂等写 `revokedAt`；撤回后旧微信卡片仍可能留在对方聊天中，但点开不能再读内容。`deleteShare` 先使公开访问失效，再物理删除；我的列表不再显示。公开有效期 90 天，过期快照仍可在「我的分享」回看，直到本人删除或删除个人数据；首版每人最多 50 份有效分享、200 份总历史，每日新建最多 10 份。达到上限时明确提示整理旧分享，不静默覆盖。

## 5. 一次性提醒 `jiancheng_daka_reminders`

### 5.1 文档结构与 ID

```js
{
  _id: "<sha256(owner:ownerEpoch:businessDate)>",
  schemaVersion: 1,
  owner: "<owner-hash>",
  ownerEpoch: "<account-epoch>",
  businessDate: "2026-09-25",   // 北京时间 YYYY-MM-DD
  slot: "20:30",                  // 三个固定时段之一
  dueAt: "<UTC ISO-8601>",
  templateKey: "habit-digest",   // 模板实际 ID 只在服务端配置
  generation: 1,                 // 同日取消后重新授权再安排时递增
  status: "pending" | "claimed" | "sent" | "cancelled" | "failed" | "unknown",
  acceptedReportedAt: "<UTC ISO-8601>", // 服务端收到客户端 accept 报告的时间；非平台凭证
  claimedAt: null,
  providerAcceptedAt: null,
  lastResultCode: null,           // 白名单错误码；不存完整平台响应或 token
  updatedAt: "<UTC ISO-8601>"
}
```

同一 owner／日期只有一个文档，天然聚合最多 5 个任务。`_id` 由服务端算；日期、时段由服务端再次校验为未来有效计划日。`dueAt` 存 UTC，展示时用北京时间；以平台实际时区测试为准。授权拒绝不写待发文档；前端报告 `accept` 只用于创建候选，不能伪装成可信额度，平台发送结果才是权威。模板不适用或本账号未获资格时整条能力保持关闭。

### 5.2 状态机与防重复

```text
无记录 --用户点击且平台授权回 accept--> pending
pending --用户取消／当天全部完成／账户删除--> cancelled
pending --到期事务认领--> claimed
claimed --平台明确接受发送请求--> sent
claimed --明确不可重试错误--> failed
claimed --超时或结果不明--> unknown
```

`claimed/sent/failed/unknown` 不自动回到 `pending`。定时器重复触发时只有一个执行者能以事务把 `pending` 改为 `claimed`；外部平台调用不在数据库事务内，因此无法保证与状态写入原子化。调用超时不能盲目重试，优先避免一人收到重复通知。取消后同日若再次申请，必须重新得到一次明确授权并增加 `generation`；已认领或结果未知不允许同日重新安排，避免并发双发。发送前再次读 owner 当前 epoch、业务日和当日未完成数；若任一检查失败，取消而非发送。

查询／显示的 `sent` 只代表平台接口明确接受，**不是用户已阅读或百分之百送达**。计划的全局停发开关、批次上限和费用阈值不放客户端；停发期间不声称仍会定时提醒。

## 6. 接口、身份与权限矩阵

| 动作 | 最小输入 | 身份与数据访问 | 返回 |
| --- | --- | --- | --- |
| `getPreferences` | 无业务 owner 参数 | 受信上下文 owner；只读本人偏好与账户 epoch | 默认或当前偏好＋revision |
| `setPreferences` | `operationId, expectedRevision, patch` | 受信 owner；白名单字段；CAS | 确认偏好＋新 revision |
| `createShare` | `requestId, kind, sourceHabitId?, categoryKey?, includeWeekdays?, captionKey?` | 受信 owner；从本人云账户计算；写本人分享 | `shareId, expiresAt` |
| `listMyShares` / `revokeShare` / `deleteShare` | 游标或 `shareId` | 受信 owner 且文档 owner 匹配 | 本人列表或确认状态 |
| `getPublicShare` | `shareId` | **仅**公开只读函数；精确 ID＋状态／epoch 门禁 | 白名单快照或统一不可用 |
| `scheduleReminder` | `slot, subscriptionResult='accept', operationId` | 受信 owner；服务端记录报告时间并择日期；模板及开关门禁 | 一次性待发状态 |
| `getReminder` / `cancelReminder` | `businessDate?` | 受信 owner | 本人下一次状态 |
| `reminderTick` | 平台定时事件 | 仅定时触发，拒绝普通客户端直接发送 | 内部批次计数，不返回私人数据 |

接口请求一律校验字段白名单、字节数、枚举、日期、分页数量和 ID 格式；错误响应不包含原始用户标识、备注、平台密钥、堆栈或原始 SDK 响应。`createShare` 与 `scheduleReminder` 需要操作 ID 重放保护；公开接口不给账户快照或「是否存在某位用户」的差异化错误。所有集合权限设为**客户端不可直接读写、仅本项目专属云函数服务端访问**；具体规则在共享云控制台核实，不能靠集合名前缀代替访问控制。

## 7. 索引、容量与成本

| 集合 | 必要索引／访问模式 | 边界 |
| --- | --- | --- |
| accounts | 已有文档 `_id`；新增删除清理标记的受控扫描索引需验证平台支持 | 原 700 KiB 及 256 回执限制保持 |
| preferences | `_id=owner` | 1 文档／账户，按需创建 |
| shares | `_id` 公共精确读取；`owner + createdAt DESC` 本人分页 | 50 有效／人、200 总历史／人、10 创建／日；公开响应 ≤2 KiB |
| reminders | `_id` 防同日重复；`status + dueAt` 到期批量查询；`owner + businessDate` 本人读取 | 每人每天最多 1 个，三时段固定触发，批次大小及全局上限发布前量测 |

这些都是**所需索引设计**，尚未在正式云创建或测量。公开页只做单份读取，不保存打开流水或访客身份；既降低成本，也避免无必要的个人信息处理。上限是应用约束，不代表云套餐配额。账单阈值与定时触发器实际时区／费率以正式控制台核验后填写，不在此文猜金额。

## 8. 删除、恢复和跨设备安全

### 8.1 删除个人数据

现有 `purge` 会重置主账户并换新 epoch，阻止离线旧设备复活。新增集合后必须扩为两段式：

1. **立即封锁**：主账户事务换 epoch、清空主数据，并在最小删除回执中标记 `cleanupPending=true`。公开分享读取和提醒发送每次均检查 `ownerEpoch`；提交以后**新发起**的旧分享读取与待发提醒应被拒绝，即使旁路文档还没物理删完。已在途的读取／平台发送可能与删除竞态，不能虚称已从对方设备收回内容。
2. **物理清理**：按 owner 分批删 preferences、shares、reminders；全部成功才将 `cleanupPending=false` 并向客户端确认「个人数据已删除」。若清理失败，返回「删除处理中，请重试」，客户端保留待确认删除操作及本机恢复材料，不得把云端已清空的快照自动当成正常空账户覆盖本机数据；同一个删除 `operationId` 重放时必须继续清理，不能沿用现有「发现回执立即成功」的捷径。定时修复作业也须扫描未完成清理标记，直至清完。

这要求实施时修改当前 `purge` 回执处理及恢复测试；不能只新增集合而继续沿用旧删除文案。最小删除回执按现有防复活目的保留，不储存公开内容。若账号重建，新 epoch 不得重新认领旧偏好或旧分享。云资源清理不可恢复；部署前应保存非敏感的集合配置、索引和函数版本用于回退，不能拿生产个人数据做测试。

### 8.2 分享与账户状态

- 主账户暂时读取失败时，公开分享 fail-closed，不能为了展示而忽略 epoch 门禁。
- 私人计划编辑、暂停或归档不改已发布快照；本人撤回或 90 天到期可终止外部访问。
- 接收者「创建同款」会创建**自己的**习惯 ID 和账户记录；不会写回原作者账户。
- 共享正式环境中的其他小程序即使能调用云环境，也不得列出、改写本项目私人集合；账号隔离需用两个真实微信用户及资源方／使用方来源测试。

## 9. 兼容、发布及验证

主账户 `state.schemaVersion=1` 不变；新 `completeMinimum` 写出的仍是既有 `Record` 形状。先发布可识别新命令的服务端，再发布客户端；旧客户端继续走原命令。旁路集合从空开始，不搬旧测试云或本机开发记录。新集合或函数任一不可用，不得影响既有打卡、导出和删除；但涉及个人数据删除时必须真实清理旁路资源，不能静默降级。

测试至少覆盖：两个 owner 互不可读写；不同小程序来源被拒；分享 ID 猜测／篡改、撤回／到期、公开接口故障、删除后立刻不可读；重复创建只出一份；提醒同日去重、时区、取消、平台超时 `unknown` 不重发、已完成不发；偏好 CAS 冲突；主账户 700 KiB 边界不变；删除半途失败及同 operationId 续清理。自动化、模拟仓库、微信工具、Android/iOS 真机、实际云权限和实际消息送达分别留证。当前没有执行任何数据库创建、迁移、部署或数据写入。
