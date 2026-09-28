# Proposal

## Why

测试云的活动客户端仍调用 `habitApi`，账户集合仍叫 `yidian_accounts`，与本应用已采用的 `jiancheng_daka_` 命名不一致。单改客户端名称会使已有打卡不可读，因此需要受控迁移，而不是静默改名。

## What Changes

- 在使用方自己的测试环境核实、部署并启用 `jiancheng_daka_api` 与 `jiancheng_daka_accounts`。
- 对现有测试账户先留可恢复副本，再迁移、校验；活动客户端切换到前缀函数和隔离的缓存范围。
- 真实创建、读取、打卡和重启恢复均通过后，清理确认不再被引用的旧测试函数与集合。
- 非目标：不改共享正式环境、不碰其他小程序函数、不自动开启分享、提醒或 AI，不将测试记录当生产数据。

## Capabilities

### New Capabilities

- `prefixed-test-cloud`: 测试环境使用本应用前缀资源，迁移时保留已确认记录与可回退边界。

### Modified Capabilities

无。

## Impact

- 本地：`miniprogram/config/cloud.js`、相关测试和迁移记录。
- 云端仅 `cloud1-d4gq76oyt363f08a7` 中的 `jiancheng_daka_api`、`jiancheng_daka_accounts`，以及切换验证后待清理的 `habitApi`、`yidian_accounts`。
- 迁移前实时核验已有资源与数据；当前只读清单显示两函数都存在，旧集合 1 条账户文档，新集合不存在。资源存在不代表新函数代码或环境变量已验收。
