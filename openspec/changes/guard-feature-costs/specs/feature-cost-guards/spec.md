# Feature Cost Guards

## ADDED Requirements

### Requirement: Atomic bounded request quotas

系统 SHALL 在新增功能的业务读写前检查每用户与全局请求上限，所有生效计数使用事务一次确认，旧窗口不得覆盖新窗口。

#### Scenario: Concurrent quota exhaustion

- **WHEN** 多实例请求同时消耗剩余额度
- **THEN** 成功数不超过窗口剩余上限，拒绝不执行后续业务读写。

#### Scenario: Database unavailable

- **WHEN** 限流存储异常或配置无效
- **THEN** 新增功能失败关闭且不向客户端暴露 SDK 细节。

### Requirement: Separate platform cost gates

系统 SHALL 将应用请求额度和平台防滥用/费用防护分开验证；入口需要显式确认限流部署门禁。

#### Scenario: Limits not verified

- **WHEN** 操作者未启用限流验收开关或未配置有效限额
- **THEN** 新增功能不会发起业务调用。

### Requirement: Private limiter cleanup

系统 SHALL 仅存储派生用户标识与计数，不存请求内容；用户删除时清理其私有额度文档而不退还全局计数。

#### Scenario: Delete account

- **WHEN** 该账户删除完成
- **THEN** 其额度文档删除，其他用户和全局窗口不改变。
