# Budgeted AI Plan

## ADDED Requirements

### Requirement: Constrained AI output

系统 SHALL 只展示由审核目录构成的计划，目标不得超过用户本次可用时间，模型任意文本不得直接展示、公开或落库。

#### Scenario: Invalid model output

- **WHEN** 模型输出额外字段、未知动作、超出时长或截断 JSON
- **THEN** 不产生可采用的建议，用户仍可使用本机规则。

### Requirement: Reserve before billing

系统 SHALL 在模型调用之前事务预留用户次数及全局日/月最大成本，同一请求只能发起一次模型调用。

#### Scenario: Concurrent duplicate or unknown response

- **WHEN** 多设备重复请求或供应商结果不明
- **THEN** 不重复调用供应商，不退还可能已经消耗的预留额度。

#### Scenario: Budget unavailable

- **WHEN** 预算配置无效、配额用完或数据库故障
- **THEN** 不发出模型请求，保持规则建议可用。

### Requirement: Identity and deletion isolation

系统 SHALL 仅接受受信账户和同意，只传最少本次安排；删除或代际变化后不返回旧建议，也不重建旧回执。

#### Scenario: Deleted during generation

- **WHEN** 生成过程中账户被删除
- **THEN** 迟到结果丢弃且不能复活请求记录。
