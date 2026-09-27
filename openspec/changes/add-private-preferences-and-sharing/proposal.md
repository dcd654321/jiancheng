# Proposal

## Why

现有小程序没有可供别人打开的分享快照，也没有本人回看和撤回；多个任务还不能固定一个重点。用户已授权按详设完成剩余开发。

## What Changes

- 独立认证功能入口支持偏好 CAS、置顶、分享预览/创建/本人列表/撤回/删除。
- 独立公开入口只按随机请求派生的 ID 读取白名单快照；无个人账户注册副作用。
- 新增前端分享创建、公开阅读、本人管理及置顶操作，默认部署能力关闭。
- 扩充主账户删除为封锁旧代际后清理旁路数据，失败允许同操作号续清理。
- 旁路索引保存在私有偏好文档中，避免依赖事务内范围查询；不改变习惯 state schema。

非目标：本变更不启用真实推送或 AI、不部署正式环境、不代用户转发，不记录发送对象或访客身份。

## Capabilities

### New Capabilities

- `private-preferences-and-sharing`: 用户偏好、可撤销分享及删除联动。

### Modified Capabilities

无。

## Impact

新增 `jiancheng_daka_features`、`jiancheng_daka_public_share` 函数和 `jiancheng_daka_preferences`、`jiancheng_daka_shares` 集合。既有主账户删除接口需要兼容升级；实际部署和共享身份确认单列，不修改资源方认证。
