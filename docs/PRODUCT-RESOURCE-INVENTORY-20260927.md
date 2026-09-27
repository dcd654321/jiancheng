# 正式环境资源总清单与执行记录

目标环境：`product-d2g59zty74d7d1ec1`。资源方：`wx7ad85943fe81e095`；使用方：`wx58e61dffcbfa4249`。分支 dev，起点 e04c83a。用户本轮明确要求整理并在正式环境创建所需集合和函数。仅管理本应用专属资源，不删除现有数据、不启用 AI/消息、不改其他应用、不合并 main 或发布。

机器可读清单：`deploy/product-resources.json`。它是所需配置，不是部署完成证明。所有名称和访问模式均对照当前 server 与 cloud-resources 源码。

## 1. 云函数（5 个）

| 函数 | 用途 | 本轮核验与处理 |
| --- | --- | --- |
| jiancheng_daka_api | 账户、习惯、打卡、同步、删除关联数据 | 已存在 Active；旧版本 1 已备份，未在本轮覆盖 |
| jiancheng_daka_features | 偏好、置顶、分享管理、提醒申请/取消 | 已存在 Active；部署任务曾丢失，代码版本待核验，不能盲目重建 |
| jiancheng_daka_public_share | 公开分享只读入口 | 已存在 Active；此前代码上传成功，保持关闭 |
| jiancheng_daka_plan | AI 计划建议和预算限制 | 已存在 Active；此前代码上传成功，保持关闭 |
| jiancheng_daka_reminder_tick | 受信定时提醒执行 | 已存在 Active；此前代码补传成功，保持关闭、无定时器 |

本轮查询五个函数均为 Nodejs16.13、超时 3 秒；此默认超时不满足 AI 的 8 秒请求或提醒 worker 的 25 秒处理预算。功能启用前须设置并验证适当超时，不能把函数 Active 视作运行配置就绪。不要新建第二套同用途函数或 habitApi。

## 2. 数据集合（7 个）

| 集合 | 存储内容 | 访问与保留策略 |
| --- | --- | --- |
| jiancheng_daka_accounts | 主账户、习惯、打卡、版本、代际、幂等回执 | 按账户文档 ID 访问；不自动过期 |
| jiancheng_daka_preferences | 置顶、偏好、本人分享目录、有界回执 | 按 owner 文档 ID 访问；删除账户时清理 |
| jiancheng_daka_shares | 分享快照、owner/ownerEpoch、状态、逻辑有效期 | 服务端公开白名单读取；过期快照保留本人回看，不设 TTL |
| jiancheng_daka_limits | 全局/个人分钟与每日计数 | 固定文档 ID；窗口原地更新，不设 TTL |
| jiancheng_daka_reminders | 预约时间、加密接收者、状态、有限回执 | Date 类型 expiresAt=dueAt 后 14 天；需验证 TTL |
| jiancheng_daka_ai_requests | 用户请求去重、预算预留状态、每日次数 | 每 owner 一个有界文档；删除账户时清理 |
| jiancheng_daka_ai_budget | 全局日/月 AI 预算 | 固定 global 文档，无身份；窗口原地更新 |

七集合都要求客户端禁止直接读写，仅由服务器按可信身份访问。公开分享也不能直接放开 shares 集合。集合为空时无需初始化用户、示例习惯或预算假数据，业务事务按需创建，避免构造不符合约束的种子文档。不另建 users/habits/checkins/feedback：习惯与打卡已在 accounts 快照中，反馈使用微信原生能力。

### 存在性核验更正

此前 checkCollection 对七集合都返回 exists=true，describeCollection/listIndexes 又没有明细。本轮完整 listCollections（limit=100，pager.Total=6）中没有任何 jiancheng_daka_ 集合。因此撤销“七集合已存在”的结论，按完整清单缺失处理；不发布其他应用的统计或数据。今后必须以完整列表、明确索引数组和实际返回交叉核验，不把 success 文案当资源存在证据。

### 首次创建任务（已确认完成，不得重复提交）

tool=`cloud_db_write_struct`，client=`codex`，action=`createCollection`；appid/env 见顶部。七个独立任务首次返回 pending。用户回复“已全部允许”后逐一查询原任务：均为 success/execution_success，内层均为 createCollection 成功；随后完整列表也返回七个精确名称，记录数均为 0。创建已完成，无须再次允许或重发。

| 集合后缀（统一 jiancheng_daka_） | taskId | 最后已知状态 |
| --- | --- | --- |
| accounts | confirmation_cloud_db_write_struct_371fba62-9cf5-4490-b6b2-422ecb91d897 | success；列表已核验 |
| preferences | confirmation_cloud_db_write_struct_58accee2-dff0-433a-afa2-560af3f06756 | success；列表已核验 |
| shares | confirmation_cloud_db_write_struct_0419e876-b124-4642-b1cc-e93b099ed40f | success；列表已核验 |
| limits | confirmation_cloud_db_write_struct_78e3dd01-0318-44f9-b718-d3d7abf1c4f5 | success；列表已核验 |
| reminders | confirmation_cloud_db_write_struct_ea013409-4e0b-44f1-a5fa-1a5e04d16c8f | success；列表已核验 |
| ai_requests | confirmation_cloud_db_write_struct_96d491e2-37a7-47f4-b0b9-9e32d8626ae0 | success；列表已核验 |
| ai_budget | confirmation_cloud_db_write_struct_b1f6d18c-43ee-43d0-8312-246f77349e91 | success；列表已核验 |

交叉核验 listCollections 的 requestId 为 `ba12837f-915b-4f57-9f7d-0d509c494035`，limit=100，响应未分页遗漏；不记录其他应用明细。七个集合各有两个默认索引。安全规则不在这个结果中，不能据此声称 deny-all 已配置；未核验前不写任何个人记录、不启用客户端。

## 3. 索引（4 个业务索引 + 1 项 TTL 要求）

| 集合 | 索引 | 键 | 用途 |
| --- | --- | --- | --- |
| shares | jiancheng_daka_share_owner_epoch | owner ASC, ownerEpoch ASC | 删除账户时有界清理 |
| reminders | jiancheng_daka_reminder_owner_epoch | owner ASC, ownerEpoch ASC | 删除账户时有界清理 |
| reminders | jiancheng_daka_reminder_due | status ASC, dueAt ASC | 按时间取待发送任务 |
| reminders | jiancheng_daka_reminder_claimed | status ASC, claimedAt ASC | 收敛超时认领状态 |

四项均非唯一；其余访问按默认 _id，不新增无用索引。参数位于 `deploy/indexes/*.json`。依据[官方管理 SDK](https://docs.cloudbase.net/api-reference/manager/node/database)，同名创建可能先删后建，执行前必须读取现有索引；只对确认缺失项创建，不直接重跑全量文件。

用户确认集合创建后，真实 listIndexes 返回 shares 与 reminders 均只有 `_id_`、`_openid_1` 两个默认索引，四个业务索引都不存在；查询 requestId 分别为 `d5144e83-71b2-4fa5-9897-22eca6f5fa27`、`1533001a-ca57-4864-831a-e172096d0823`。据此各提交一次 updateCollection（只有 CreateIndexes，没有 DropIndexes）：

| 集合 | 新增范围 | taskId | 最后状态 |
| --- | --- | --- | --- |
| jiancheng_daka_shares | owner_epoch 1 项 | confirmation_cloud_db_write_struct_7d5281f0-ab93-45ac-a116-31f0060929f0 | success；索引明细已核验 |
| jiancheng_daka_reminders | owner_epoch、due、claimed 3 项 | confirmation_cloud_db_write_struct_6c4ba448-9abe-4bd0-a42a-584d8bbd2654 | success；索引明细已核验 |

2026-09-28 用户继续后查询原任务，两项均为 success/execution_success，内层 updateCollection 成功。随后 listIndexes 核实 shares 增至 3 个（含默认索引），reminders 增至 5 个（含默认索引）；四项名称、键顺序、非唯一属性与清单一致，查询 requestId 分别为 `85e8a994-e7e0-4a58-b151-a8c8ded9b059`、`007f5799-ee35-4cf7-85ff-ba457c9745e1`。四个普通业务索引已完成，不能据此宣称 TTL 或集合安全规则完成。

reminders 的 `expiresAt` 需 Date 类型 TTL，expireAfterSeconds=0，不能用一个普通升序索引冒充 TTL。当前工具参数资料只明确了普通索引字段，TTL 接口/控制台仍待核实，不猜参数或提前勾选 HABIT_REMINDER_TTL_VERIFIED。TTL 会删除到期提醒元数据，不作用于账户/习惯/分享历史。

## 4. 启用配置与外部依赖

- 账户函数：HABIT_APP_ID、HABIT_MINIPROGRAM_ONLY、HABIT_API_ENABLED；启用旁路能力前必须保留对应删除清理。
- 分享/偏好：身份、旁路清理、限流验证及各功能开关；预算计数不依赖客户端。
- 提醒：模板资格、接收者加密密钥、受信定时器密钥/名称、字段映射、发送状态、配额、TTL、身份/发送归属和真实送达；只建函数和集合不创建发送定时器。
- AI：实际供应商/模型/服务端密钥、每次/每天/每月预算及用户日限额、隐私同意和有效率验证；本轮不购买服务或调用付费模型。
- `cloudbase_auth` 是共用依赖，不是本应用要新建的第六个函数。此前已实测本 AppID 被共享初始化以 403 拒绝；本轮创建集合不会自动消除此问题。只读核对共享条目和认证源码可以继续，需要改共用认证时必须限定影响并取得明确授权。
- 正式客户端继续关闭，不迁移旧测试缓存和队列；基础资源完成后还需共享身份、读写隔离和真机验收。

## 5. 恢复边界

新增空集合与索引保留不动即可；不自动执行删除回滚。已有函数不重建，主 API 不丢弃平台版本 1。文档/清单可用 Git revert 撤销，但不会撤销已经确认的云写入。任何失败记录精确任务 ID 与真实结果，重试必须先核验旧任务终态和远端现状。

## 6. 本轮本地验证与未完成项

- 全量测试：301 通过，0 失败、0 跳过；新增 3 项验证清单覆盖、索引参数一致性及默认安全边界。
- 静态检查：236 项通过；云端生成副本一致性：61 文件通过；OpenSpec 严格校验：9 项通过；git diff --check 通过。
- 本轮仅新增部署清单、索引参数、测试和执行文档，未修改业务逻辑。上述测试不证明云端创建成功或权限已生效。
- 后续用户已允许七集合创建，原任务及完整列表交叉核验通过；四个普通业务索引的原任务及实际索引列表也已交叉核验通过。权限、TTL、函数实际版本与超时配置仍须逐项核验。共享初始化 403 尚无解除证据。
- 权限/TTL 补查：describeCollection 仅返回索引明细，不返回安全规则；Computer Use 只读查看时当前工作区被本次索引确认弹窗遮挡，未继续输入或操作其他工程；未取得权限/TTL 配置证据。
- 2026-09-28 只读复核：本应用五个函数与共用 `cloudbase_auth` 均为 Active/Nodejs16.13/超时 3 秒；该元信息不含实际代码、变量或共享授权条目。官方环境共享说明要求资源方将目标环境授权给使用方；上一轮本 AppID 的原生共享 init 返回 403。浏览器控制在微信公众平台登录页被安全策略阻止，未绕行登录；当前桌面窗口被另一个工程使用，因此未点击其配置。已请求用户提供资源方正式环境“环境共享”条目截图；在核实并取得必要的共用资源变更授权前，客户端和云函数业务开关保持关闭。
