# 运营监控接入

渐成接入共享环境中的 `monitorApi`，客户端继续复用同资源方和环境的共享云初始化。开发版、体验版写测试环境 `cloud1-d8gopnalv908bb47a`，正式版写生产环境 `product-d2g59zty74d7d1ec1`。本地接入不表示已部署或已采集生产数据。

## 上报内容

每次进入前台生成会话，首次账户读取完成后绑定账户和数据代际。启动时上报 `trackUsage/start` 与 `app_start`，每 60 秒上报累计前台毫秒，进入后台发送 `end`。累计时长从监控启动确认开始，后台时间和账户未加载完成的时间不计入。账户读取始终失败时不发送无法绑定的会话；后台冻结或进程被关闭时，最后一段未上报时长可能丢失。启动未成功的会话不会先发送心跳或结束，避免乱序创建不存在的会话。

运行错误只上报 `APP_ERROR`，未处理拒绝只上报 `UNHANDLED_REJECTION`；业务云请求上报函数名、耗时和固定结果代码。字段仅包括页面路由、运行版本、会话、函数名、固定代码和毫秒。不上报原始错误、堆栈、习惯名称、备注、手机号、头像、昵称或位置。客户端上报失败最多在内存等待一秒重试一次，事件标识不变；最多保留 64 个重试项，不写设备存储。账户变化清理旧上下文；监控请求不触发自身性能监控。

主业务事务提交成功后，云端向 `monitor_events` 写 `habit_created` 或 `checkin_completed`。创建必须出现新的习惯，完成必须由未完成变成标准/忙时完成；重放、重复完成、备注、调目标、失败和待删除状态不计数。撤销后重新完成是一次新的已确认行为。事件使用服务端 Date、固定应用键 `jiancheng` 和可信调用方身份摘要，payload 仅保存业务日期、完成档位和可选会话。

`sourceUserId = user_ + SHA256(调用方 AppID + '|' + OpenID).slice(0,24)`，用于运营用户去重，不是匿名化承诺。业务事件 `eventId = SHA256(epoch + '|' + operationId + '|' + type)`；文档 ID 为 `evt_ + SHA256('jiancheng|' + sourceUserId + '|' + eventId)`。写入失败只记录 `MONITOR_WRITE_FAILED`，业务保存保持成功；没有持久补偿队列，故障时可能少计。

## 接口与发布次序

- `monitorApi.trackUsage`：`eventType: start|heartbeat|end`、`sessionId`、`elapsedMs`（累计前台毫秒）、冻结的 `accountGeneration`（账户 epoch）。
- `monitorApi.ingestEvent`：`type: app_start|error|unhandled_rejection|performance`、稳定 `eventId`、白名单 `payload`、冻结的 `accountGeneration`。
- `jiancheng_daka_api.mutate`：增加可选 `sessionId`；参与原请求指纹，未知结果重试继续发送原值。`pull/purge` 不接受该字段。

先部署共享监控函数及其集合权限，再部署升级后的 `jiancheng_daka_api`，最后上传小程序。新业务 snapshot 声明 `capabilities.monitorSessionMetadata=true`；客户端只在可信读取明确支持时加入 `sessionId`，旧业务函数缺少声明时仍发送原信封，避免新客户端阻断旧版保存、打卡和撤销。监控函数按可信 `FROM_APPID/FROM_OPENID` 识别渐成，正文不提供 AppID/OpenID；不开放客户端直读写集合，不调整业务来源白名单。

## 个人数据清理

“清除个人数据”在账户事务中先换 epoch 并保留 `cleanupPending`，随后按可信账户身份清理本应用的 `monitor_users/monitor_usage_daily/monitor_usage_sessions/monitor_events`。SDK 明确集合不存在码 `-502005` 时跳过该空集合；权限、网络、未知错误或单次批次上限继续返回删除处理中，原请求或下次启动读取会继续清理，全部完成后才返回成功。其他用户、其他应用和没有用户身份的 `monitor_meta` 保留。

共享监控事务和业务事件事务在写入前读取当前主账户，要求请求 `accountGeneration` 与当前 epoch 一致且不在清理中。已发出的旧心跳、旧错误、旧启动和迟到业务事件不会恢复已删除的个人记录。客户端同样丢弃旧代际的等待重试；冻结请求不会换成新账户的代际。隐私入口说明运营字段与同步清理范围。

回退客户端与习惯 API 到接入前版本会停止产生新遥测；已有运营记录仍需用包含清理能力的版本完成个人删除，不能在仍有遥测时退回只清理业务账户的旧函数。业务账户和习惯不会被迁移。部署、真实监控调用、真机时长、双账户隔离和看板结果仍需独立验收。

## 本地验证

2026-10-12 全量回归：525 项测试、379 项检查、53 个云文件一致性和 23 个 OpenSpec 严格校验通过；原生编译 16 个 WXML、15 个 WXSS 通过。新增监控卡住/迟到拒绝、可选生命周期异常、旧云函数协议兼容、未创建统计集合的全量删除，以及新前台会话取消旧重试回归。事务使用同一账户顶层 `_monitorFence` 写屏障，并通过快照交错模型与真实 SDK update/inc 合同验证。未提交、推送、部署或执行真实监控写入。证据与限制见 [verification.md](../openspec/changes/add-operations-monitor/verification.md)。
