# Spec Delta

## ADDED Requirements

### Requirement: 私有偏好和身份隔离

系统 SHALL 仅从受信上下文识别 owner，验证期望 epoch 并以独立 revision 更新本人偏好；系统 SHALL 不接受客户端 owner 或伪造身份。

#### Scenario: 并发修改设置

- **WHEN** 两个设备用相同旧 revision 修改偏好
- **THEN** 只有一个成功，另一个收到冲突并重新读取，不能覆盖新偏好

### Requirement: 明确预览后创建不可变分享

系统 SHALL 从云端真实数据生成白名单预览，要求创建时源 revision 匹配；同请求 SHALL 只创建一份，受每日、活跃与历史总量限制。

#### Scenario: 预览后源计划改变

- **WHEN** 用户确认发布时账户 revision 已变化
- **THEN** 要求重新预览，不能发布未经用户看过的内容

#### Scenario: 删除后重放创建请求

- **WHEN** 相同 requestId 的分享已被删除而客户端重试
- **THEN** 返回不可用而非再次公开，其他人的分享不变

### Requirement: 公开读取和本人管理

系统 SHALL 只按单一 ID 公开允许字段；撤回、到期、代际不符、清理中或读取失败时统一不可用。本人 SHALL 能分页回看、撤回和删除自己创建的快照，不记录发送对象或阅读者。

#### Scenario: 其他用户尝试管理

- **WHEN** 用户以他人的 shareId 请求撤回、删除或私有详情
- **THEN** 拒绝且不泄露所有者或私有数据

### Requirement: 删除联动与续清理

系统 SHALL 在清理旁路前更换主账户 epoch，物理清理成功后才确认删除；清理失败的同操作号重试 SHALL 继续清理而非直接返回成功。

#### Scenario: 清理中断

- **WHEN** 分享已封锁但数据库清理失败
- **THEN** 旧链接不可再读取，客户端保留恢复材料且提示处理中，重试可完成
