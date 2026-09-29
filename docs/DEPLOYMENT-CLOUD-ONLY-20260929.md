# 云端唯一存储版本部署记录（2026-09-29）

## 授权与边界

用户授权：先在测试环境验收；验收通过后，将同一版 `jiancheng_daka_api` 云函数同步到 `product`。用户进一步确认 **只部署云函数，客户端默认环境暂不切换**。`main` 不合并，不操作共用环境其他函数、集合、权限或环境变量。

候选代码：`dev` 提交 `b7b3a90`。完整目录 `D:\codex\coding\yidian-miniprogram\cloudfunctions\jiancheng_daka_api`。测试目标 AppID `wx58e61dffcbfa4249`，环境 `cloud1-d4gq76oyt363f08a7`；正式目标资源方 AppID `wx7ad85943fe81e095`，环境 `product-d2g59zty74d7d1ec1`。两者只更新同名函数。

## 部署前证据

- `dev` 已推送且与 `origin/dev` 一致；工作区原有设计文档改动未被纳入候选提交。
- 本地 274 项测试、云包一致性、Node 16.13.2 SDK 载入与原生 WXML/WXSS 编译通过。
- 微信开发者工具自带 `wechatide-skill` 0.3.9 状态为版本匹配、已登录、无需 CLI token。
- 测试环境 `jiancheng_daka_api` 部署前为 `Active`，Nodejs16.13、超时 3 秒。
- 正式资源方环境列表确有 `product-d2g59zty74d7d1ec1`；其中同名函数部署前为 `Active`，Nodejs16.13、超时 3 秒。此次仅只读查询，未在该环境部署或写数据。
- 两个目标环境中的 `jiancheng_daka_accounts` 均由只读结构检查确认存在；这不证明集合权限、业务索引、TTL 或真实读写已经验收。

## 执行状态

- 测试环境部署：已发起 `cloud_fn_deploy`（`--remote-npm-install`），返回 `pending`，任务 ID `confirmation_cloud_fn_deploy_5603e488-4319-49f3-814e-a308dea68a25`；等待微信开发者工具内的用户确认。**尚未证明部署成功，不得重发同一部署。**用户确认后先用 `polling_task_result` 查询这个旧 ID。
- 测试环境真实读取/修改/读回/恢复验收：未执行。
- `product` 同版云函数部署：未执行，取决于测试验收。
- 客户端环境切换、正式环境真实写入、体验版上传、真机和双账号验收：不在本次授权范围。

部署为远端写操作，Git 回滚只回退源码，不会自动回退云函数。若发生问题，需以确认过的上一个云包单独部署回滚；不得删除集合或清空账户来“修复”。
