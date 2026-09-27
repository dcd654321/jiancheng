# Proposal

## Why

用户要求增加提醒。现有计划时间仅排序，不发通知。按已确认详设实施一次性聚合提醒，不能声称每天自动提醒。

## What Changes

- 新增我的提醒页面，服务端预演下一次计划日，用户主动授权后才登记一次。
- 同账户同日一条任务；取消后重新授权可有限次重建，同操作号幂等。
- 独立定时发送函数，事务认领、重读当前任务、最多一次外部发送；未知结果不重试。
- 增加模板、共享发送资格、配额、定时器及加密配置门禁，默认全部关闭。

## Capabilities

### New Capabilities

- `one-shot-reminders`: 可取消且防重复的一次性习惯聚合提醒。

### Modified Capabilities

无。

## Impact

新增 `jiancheng_daka_reminders` 和 `jiancheng_daka_reminder_tick`；认证接口经已有 features 函数路由。模板 ID 是订阅请求必需的公开配置，不是密钥；收件标识由受信上下文取得并在服务端加密保存。主账户删除须保持 reminders 清理开启。实际资源、模板、订阅、触发与送达单列验收，不由本批自动部署。
