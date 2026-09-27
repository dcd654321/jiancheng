# One-shot Reminders

## ADDED Requirements

### Requirement: Explicit one-time subscription

系统 SHALL 只在用户点击且微信返回接受后登记下一次聚合提醒，时间由服务端按计划计算，不能自动续订或承诺每日消息。

#### Scenario: Authorization rejected

- **WHEN** 用户拒绝或平台授权不可用
- **THEN** 不创建提醒，打卡功能不受影响。

#### Scenario: Preview changed

- **WHEN** 授权前后计划版本、预览日期或代际变化
- **THEN** 不替用户另选新日期，返回重新确认。

### Requirement: At-most-once external send attempt

系统 SHALL 事务认领同日任务，核验最新账户与未完成数后最多调用一次发送。未知结果不得自动重发。

#### Scenario: Duplicate trigger or timeout

- **WHEN** 两个调度同时认领或外部调用超时
- **THEN** 只有一个发送尝试，超时标未确认且重复调度不再次发送。

#### Scenario: Nothing left to do

- **WHEN** 当天都已完成或账户已删除
- **THEN** 取消任务，不发送。

### Requirement: Secure default-disabled dispatch

系统 SHALL 拒绝未持有私有定时凭据的调用，并在模板、数据清理、TTL、共享权限和配额未确认时保持提醒关闭。

#### Scenario: Forged timer event

- **WHEN** 客户端伪造 Timer 事件但没有私有凭据
- **THEN** 不查队列、不发消息、不泄露错误细节。
