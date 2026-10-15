# Design

## 前台会话

会话在 onShow 创建，在账户读取完成后绑定当前 accountId:epoch；累计计时包含绑定后启动请求等待期间的前台时间，不包含未绑定账户的加载时间。首次成功启动回执提供 startedAtMs、observedAtMs 与已收 elapsedMs，客户端将成功尝试实际发起的本地时刻减去服务端已开始时长 observedAtMs-startedAtMs 作为稳定本地计时起点，不以 ACK 到达时刻重置。旧接口未提供可信服务端锚点时使用成功尝试发起时刻。启动回包丢失后的重复 start 返回原会话锚点；单次发送最多在内存重试一次，耗尽后后续心跳或同代际 end 再确认同一 sessionId，不因一次失败永久停止采集。

onHide 停止定时器并发送累计毫秒；心跳和结束时刻在请求排队之前冻结，启动确认在后台才完成也不得追加后台时间。每次重新进入前台创建新 sessionId。账户代际变化、删除处理中或重新初始化会立即丢弃旧会话和等待重试，随后可为有效新账户创建会话。固定事件标识仅保留内存，不写设备存储，不阻塞数据读取或保存。

monitorApi.trackUsage 接收 eventType=start/heartbeat/end、sessionId、elapsedMs。monitorApi.ingestEvent 接收 type、稳定 eventId 和白名单 payload。两者都携带冻结的 accountGeneration（已确认 epoch），由共享监控在同一写入事务中核验可信账户当前 epoch 和非清理中状态。app_start 的 eventId 为 sessionId:start；异常仅发送固定 code，性能仅发送函数名、耗时、固定结果 code、路由、会话和运行版本。共享传输排除 monitorApi 本身，防止递归。

共享监控在 trackUsage 的会话、用户和每日汇总事务内同时补齐稳定 sessionId:start 启动事件，客户端冗余启动事件可用于旧接口兼容。已有事件只作为重复确认，不因为回包丢失或晚到再计访问。

## 已确认业务事件

习惯 API 根据事务前后状态判断新习惯和从 pending 到 standard/minimum 的打卡；事务重放、重复状态、失败和待删除状态不计数。业务请求允许可选 sessionId，参与原请求指纹，在重试中不变化。主事务返回成功后写 monitor_events；事件标识由 app、owner、epoch、operationId、type 派生，文档 ID 使用摘要。sourceUserId 由可信调用方 AppID|OpenID 摘要生成；不接受正文身份。

运营事件保存 appId=jiancheng、type、sourceUserId、occurredAt/createdAt（服务端 Date）、eventId、accountGeneration 和白名单 payload(recordDate/status/sessionId)。独立监控事务在创建事件前核验账户 epoch、cleanupPending 和既有事件，防止迟到事件恢复已删除数据。监控写失败只输出固定 code，不改变已确认业务回执；最多等待 500 毫秒，超时输出 MONITOR_WRITE_TIMEOUT 并返回原保存确认，迟到拒绝被处理。没有持久补偿队列，因此监控故障可能造成少计；不回填旧快照。

CloudBase 使用快照隔离，单纯读取账户不会与并发删除形成写冲突。业务事件事务与每批遥测清理在全部读取完成后，先通过 `update({_monitorFence: db.command.inc(1)})` 修改同一主账户文档，再写事件或删除目标。主账户换 epoch、清理完成和监控栅栏写入同一文档发生冲突时，事务重试必须重新核验 epoch/cleanupPending。`_monitorFence` 是可选顶层内部元数据，不属于 payload、业务版本或返回给客户端的状态；主账户业务写入保留既有计数。

同一监控事务的 SDK 请求逐项等待，包括账户、既有事件、每个删除候选和写入；不通过 Promise.all 重叠发送同一 transactionId 的请求。此调整保留先读后写、栅栏和代际校验。锁定真实 SDK 的受控底层适配器验证没有重叠请求；真实云对并发请求的具体错误仍需独立验证。

## 个人数据清理

个人数据删除必须始终建立既有 cleanupPending 意图，换 epoch 后阻止旧遥测和业务事件写入。清理链按可信身份派生的 userId 删除本应用在 monitor_users、monitor_usage_daily、monitor_usage_sessions、monitor_events 中的个人记录；保留无个人身份的 monitor_meta。操作为有界分页，故障或单次批次上限继续返回 DELETE_PENDING，下次原请求重试或 pull 继续清理，全部完成后才确认成功。仅 SDK 明确集合不存在码 -502005（含对应符号码）表示该集合无记录可清理；权限、网络和模糊错误仍阻止成功确认。

每批删除必须回读同一旧 epoch 的清理意图和全部候选目标，随后修改账户 _monitorFence，再执行删除。另一清理已完成并写入新代际记录时，旧事务发生写冲突并重试，发现旧清理意图不再存在后退出，不能删除新代际记录。

## 兼容与交付

本地源码和生成云副本一起更新。上线顺序为共享 monitorApi 和集合权限、业务云函数、客户端。新业务 snapshot 返回 capabilities.monitorSessionMetadata=true，新客户端仅在可信读取明确支持时加入 sessionId；旧函数不返回该能力时保持原业务信封，原保存、打卡和撤销仍可用。冻结重试继续使用首次构造的完整信封。客户端生命周期和可选统计取值的同步/异步异常均独立收敛，不阻断主流程。测试、正式环境按现有运行版本选择，不混用。
