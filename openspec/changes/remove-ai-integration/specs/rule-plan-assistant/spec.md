# Rule Plan Assistant

2026-10-09范围更新：以下规范保留移除模型集成时的历史行为记录。`Rule based assisted creation` 与 `Isolated draft and explicit save` 中的助手入口、规则预览及助手草稿交接要求由[当前助手移除规范](../../../refine-contest-product-experience/specs/contest-product-experience/spec.md)替代；普通表单与公开轻计划仍沿用显式保存和账户隔离。`No model integration in the active application`、`Retired endpoint compatibility` 与 `Preserve legacy deletion isolation` 的模型移除、`NOT_ENABLED` 静态停用和历史删除隔离约束继续有效。历史验证记录保留，不自动删除云端资源或数据，也不授予部署与发布。

## Purpose

让用户根据习惯方向和本次可用时间获得固定规则提供的小目标方案，在不向模型供应商发送信息的情况下查看具体行动、平时及忙时目标，并自行核对安排后保存。退出模型服务时保留旧接口兼容和历史账户数据的隔离清理能力。

## ADDED Requirements

### Requirement: Rule based assisted creation

系统 SHALL 提供可从今日及我的进入的小目标助手，支持阅读、学习、整理和日常散步四方向及 1—60 分钟。方案 MUST 来自固定规则，保持用户选择的星期和时间，目标不超过输入时长，忙时目标为有效的较小正整数或空值。

#### Scenario: Preview a small goal
- **WHEN** 用户输入有效方向、分钟和安排并查看方案
- **THEN** 展示基础方案、具体行动和两档目标，不请求模型、不发送输入到第三方、不创建习惯。

#### Scenario: Invalid or offline input
- **WHEN** 输入分钟越界、空星期，或设备断网
- **THEN** 无效输入显示字段错误；有效输入断网仍可预览，保存继续要求可写的云端账户。

### Requirement: Isolated draft and explicit save

系统 SHALL 通过有期限、仅使用一次、绑定账户上下文的会话草稿进入可编辑确认页。系统 MUST 拒绝 AI 来源草稿，并在输入、账户或日期变化时使旧预览失效；只有用户明确保存且云端确认后创建习惯。

#### Scenario: Adopt and review
- **WHEN** 用户采用基础方案
- **THEN** 进入可编辑确认页，无自动写入；过期、重复消费或账户不匹配的草稿拒绝使用。

#### Scenario: Account or day changes
- **WHEN** 预览后账户上下文或当天日期发生变化，或旧页面导航回调迟到
- **THEN** 旧预览和回调不能更新新访问或提交草稿。

### Requirement: No model integration in the active application

系统 SHALL 移除面向用户的 AI 入口、生成选项、同意及供应商发送说明，活动客户端及服务端生成路径 MUST 不包含模型请求、模型密钥配置或生成预算实现。系统 SHALL 保留普通习惯创建和打卡行为。

#### Scenario: Open and use registered pages
- **WHEN** 用户打开任意注册页面、查看基础方案或采用方案
- **THEN** 不出现 AI 生成操作或宣传，不初始化模型服务、不调用旧 AI 云函数。

### Requirement: Retired endpoint compatibility

系统 SHALL 为旧模型接口提供固定的停用回执。该入口 MUST 在任意旧配置和请求下直接返回 `NOT_ENABLED`，不加载模型依赖、不访问数据库、不调用供应商且不回显请求或环境信息。

#### Scenario: Old client requests generation
- **WHEN** 旧客户端提交模型建议请求，包括旧启用开关和密钥配置已存在的环境
- **THEN** 返回停用回执，无数据库、供应商调用或费用预留副作用。

### Requirement: Preserve legacy deletion isolation

系统 SHALL 保留历史 AI 请求与限流记录的账户删除清理及私有集合访问限制。历史回执 MUST 仅按受信账户和对应 epoch 删除，不影响其他账户、新 epoch 或全局预算；移除功能过程 MUST 不自动删除或迁移线上数据。

#### Scenario: Delete an account with legacy records
- **WHEN** 用户按既有流程明确删除个人数据且历史旁路清理已配置
- **THEN** 清理本人旧 epoch 回执，保留其他账户、新 epoch 和全局预算记录。
