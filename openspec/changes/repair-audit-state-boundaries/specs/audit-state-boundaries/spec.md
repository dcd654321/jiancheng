# Audit State Boundaries

## Purpose

保证渐成在离线回执、账户删除重建、服务能力配置与跨日计划预览等边界中保持清晰且可恢复的状态，避免把晚到确认误当作当前网络可写、把旧账户拒绝缓存带给新账户，或创建不能随账户删除清理的私有数据。

## ADDED Requirements

### Requirement: Confirmed receipts respect current connectivity

系统 SHALL 接受当前账户合法回执的确认数据，同时 MUST 在当前网络离线时保持只读，不宣告可写或重发已确认操作。

#### Scenario: A receipt arrives after disconnect
- **WHEN** 读取、保存或冲突回执到达前网络已转为离线
- **THEN** 有确认数据时可只读显示，离线状态继续生效；联网重新核对后才能修改，已确认保存不重复提交。

### Requirement: Private rejection cache respects account generation

系统 SHALL 把私有限流拒绝绑定账户代次；删除清理后新代次 MUST 不继承旧代次的缓存拒绝，全球配额继续生效。

#### Scenario: Recreate after a rate limited generation
- **WHEN** 旧代次触发私有限流并经明确删除清理后建立新代次
- **THEN** 新代次按当前配额处理，旧代次请求不能更新新账户或新配额。

### Requirement: Private features require matching cleanup prerequisites

私有 features 能力 MUST 仅在 `HABIT_SIDECAR_CLEANUP_ENABLED` 和 `HABIT_LIMITS_VERIFIED` 均明确为 `true` 时进入数据库处理，其他现有能力门禁继续生效。

#### Scenario: Cleanup or limits prerequisite is missing
- **WHEN** 任一标志缺省、为空、为 false 或无效值
- **THEN** 偏好、主题、分享和提醒入口返回 `NOT_ENABLED`，无数据库访问，不创建不可清理的私有状态。

#### Scenario: Configured cleanup and limits
- **WHEN** 两项标志均为 true 且对应现有能力门禁满足
- **THEN** 当前服务按受信身份、限流、epoch 和幂等合同处理，不连带开启其他能力。

### Requirement: Rule preview remains valid only in its business day

规则助手 SHALL 保持自定义时长在跨日后可见，MUST 使旧预览、跨日交接令牌与旧导航回调失效；采用方案不自动创建习惯。

#### Scenario: Midnight between handoff and confirmation
- **WHEN** 在午夜前采用方案但次日才打开确认页
- **THEN** 旧令牌拒绝使用；重新预览后可进入确认，用户仍需明确保存。

#### Scenario: Custom duration and late navigation error
- **WHEN** 自定义时长在页面跨日时保留，旧导航失败回调随后到达
- **THEN** 自定义输入保持可见，旧回调不能覆盖当前日期变化提示或新访问状态。

### Requirement: Form submission and reentry preserve current scoped input

表单 MUST 在提交前核对绑定账户与业务日；同一草稿的较新版本 SHALL 在返回旧表单时接续，旧页面和旧保存回执不得覆盖或删除较新草稿。

#### Scenario: Save immediately after midnight without a refresh tick
- **WHEN** 普通或已采用规则方案的表单跨午夜后尚未刷新，用户立即提交
- **THEN** 拒绝发送旧上下文写入，清理旧输入并提示重新打开表单。

#### Scenario: Return from a nested form with newer edits
- **WHEN** 从表单进入管理页，再打开同一草稿并修改，然后返回原表单
- **THEN** 原表单显示较新输入，隐藏或卸载的旧实例不能覆盖它；较新草稿被放弃或确认后，旧实例不能重新生成旧草稿。

### Requirement: Creation capacity and confirmed receipt use consistent controls

创建表单 SHALL 根据当前确认状态呈现可用日期与容量；系统调整可用日期 MUST 不制造未保存修改，已确认的同 id 创建核对返回不得再次写入。

#### Scenario: Today is full but tomorrow has capacity
- **WHEN** 今天五个位置已满且明天仍可创建
- **THEN** 表单选择明天并显示原因，初始状态无放弃修改提示；恢复草稿与放弃修改后仍遵守当前容量。

#### Scenario: Reenter after the fifth creation is confirmed
- **WHEN** 创建已在云端确认，但页面导航未完成并重新进入同一草稿
- **THEN** 提供核对返回，不能因当前容量已满阻止核对，也不能重复发送创建。

### Requirement: Share navigation keeps a single active action

分享创建及采用 SHALL 在导航等待期间锁定本次操作，MUST 忽略旧页面导航回调；失败后可用既有确认回执重试而不重复创建。

#### Scenario: Repeated taps before navigation completes
- **WHEN** 本次分享创建或采用已开始进入预览或确认页，页面切换尚未完成
- **THEN** 重复点击不再次创建、交接或导航；本次导航失败可重试，旧访问回调不能解锁新访问。
