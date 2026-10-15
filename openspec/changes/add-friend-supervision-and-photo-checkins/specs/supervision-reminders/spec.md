# Supervision Reminders

## Purpose

允许打卡人和监督人分别选择下一次需要提醒的日期、时间和事项，在仍需行动时获得有界消息触达。界面明确一次预约和接收者自己的订阅授权，不承诺持续每日消息或微信准点送达。

## ADDED Requirements

### Requirement: Explicit recipient-owned appointment

系统 SHALL 提供本人和监督人两类下一次预约，支持日期、合法HH:mm和涵盖事项；每接收者每日每类最多一条。本人默认计划时间或20:00，监督人默认截止后15分钟，分别使用匹配场景模板并由接收者自己订阅。

#### Scenario: Subscription rejected
- **WHEN** 接收者拒绝授权或模板资格未配置
- **THEN** 不建立提醒，打卡、接受监督和查看记录不受影响，不挪用另一场景模板。

### Requirement: Recheck eligibility before send

系统 MUST 在认领及发送前核验当天生效计划、完成状态、关系与双方账户代际。监督提醒只包含已过截止的预约项目，照片处理中已完成不算未完成。

#### Scenario: Completed or relation ended before send
- **WHEN** 本人已完成、当天无需完成或监督关系结束
- **THEN** 从涵盖事项移除该项目，无待做事项则取消，不发送。

### Requirement: Bounded send and truthful status

系统 SHALL 复用幂等预约、事务认领、发送配额和结果未知不重发语义，支持预览、取消及近期状态；界面说明下一次时间、事项和授权，不自动续订或强制弹授权。

#### Scenario: Timeout or duplicate timer
- **WHEN** 发送超时或调度重复执行
- **THEN** 最多一次外部发送尝试，超时标未知，不以平台接受作为阅读回执。

### Requirement: Independent release gates

系统 SHALL 将监督、照片和两类消息设为独立默认关闭能力，只有适用类目/场景、私有访问、真实模板和真实收件验收后才开放；不连带开放原公开分享。

#### Scenario: Qualification incomplete
- **WHEN** 个人主体场景、模板或存储权限尚未确认
- **THEN** 对应能力保持关闭，普通打卡继续可用。

### Requirement: Minimal platform-specific configuration

系统 SHALL 将新能力发布开关集中在默认关闭的代码配置，仅保留平台相关的文件前缀、回调Token/AES密钥、监督模板ID与字段映射五项新增环境变量；固定媒体定时器名称并按独立用途派生认证消息。身份认证、签名校验及旧客户端必传守卫 MUST 保持有效。

#### Scenario: Missing configuration or old enabling variables
- **WHEN** 必要平台配置缺失、无效，或仅设置旧版新能力启用/已核验环境变量
- **THEN** 未经代码发布开关开放的能力仍保持关闭，无效媒体/模板配置不启动对应服务。

#### Scenario: Media timer authentication and rollback
- **WHEN** 使用其他定时器消息、错误名称或客户端伪造定时器，或关闭新入口但保留已准备存储
- **THEN** 非法触发在读写数据库前拒绝；关闭入口后核心必传规则及既有附件清理继续有效。
