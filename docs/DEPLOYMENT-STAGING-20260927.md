# 2026-09-27 正式云分阶段部署记录

## 授权与边界

用户在说明下一阶段会调整 product 中本应用 jiancheng_daka_* 资源后回复“继续吧”。本轮允许该范围内实施，不改其他小程序或 cloudbase_auth，不合并 main，不发布小程序。记录不包含身份样本、密钥、环境变量值或账户数据。

环境 product-d2g59zty74d7d1ec1，资源方 wx7ad85943fe81e095，使用方 wx58e61dffcbfa4249。源码基线 8ed505c，工作分支 dev，开发前已同步 origin/dev。

## 备份门禁与阶段调整

官方开发者工具 0.3.9 门禁通过：版本匹配、登录有效，无需额外 CLI token。只读云函数清单确认本应用已有 jiancheng_daka_api；四个新增函数均不在清单中。

现有 cloud_fn_info 只返回 name/status/timeout/runtime，没有代码包、版本摘要、下载入口或环境变量。不能据此生成可靠的线上备份，因此本轮不覆盖主函数，也不把仓库版本冒称线上备份。集合结构查询没有返回完整结构，安全规则/索引/TTL仍未核实。

微信身份文档的浏览器访问被安全策略拒绝，未尝试绕过；已查看[官方 wx-server-sdk 源码](https://github.com/wechat-miniprogram/wx-server-sdk/blob/master/index.js)，其 getWXContext 动态读取平台上下文字段，但这本身不足以证明本项目共享 FROM_* 字段的映射。身份适配和启用继续保持门禁。

## 第一阶段：仅创建未启用的新函数

精确目标：jiancheng_daka_features、jiancheng_daka_public_share、jiancheng_daka_reminder_tick、jiancheng_daka_plan。

- 不覆盖 jiancheng_daka_api，不调整共用授权。
- 不设置任何业务启用变量、不创建定时器、不填订阅模板或 AI 密钥。
- 缺少显式门禁时，入口在业务查库、消息发送或供应商访问前返回未开放状态；客户端入口仍关闭。
- 每个函数先记录异步结果，再决定后续动作。待确认不算成功，不因等待而重复部署。
- 所有新函数不存在的只读清单是创建基线，不涉及覆盖已有函数版本。
- 若部署失败，不自动删资源或放宽权限。回退先保持关闭；实际删除另列目标与恢复边界。

此阶段不表示功能已经可用，不勾选共享身份、配置备份、正式联调或上线验收。

## 部署前验证

- npm test：296 通过，0 失败、0 跳过。
- npm run check:cloud：61 个生成文件一致。
- OpenSpec strict：9 项通过。
- 实际使用 Node v16.13.0 运行 scripts/check-node16.cjs：54 个云端 JS 文件可解析，wx-server-sdk 可加载、crypto.randomUUID 可用。不是完整 Node 16 行为回归；完整自动测试仍由 Node 24 运行。
- Node 16 临时运行时来自 npm 的 node@16.13.0；未切换系统默认 Node、未修改业务依赖。

## 执行结果

已发起第一项 jiancheng_daka_features 部署，开发者工具返回待用户确认。外层 success=true 只表示确认任务创建成功，不代表云函数部署成功。

- taskId：`confirmation_cloud_fn_deploy_d6b09639-bd60-4d99-a0ac-c0f02b6441bb`
- 原工具：`cloud_fn_deploy`
- clientName：`codex`
- appid：`wx7ad85943fe81e095`
- env：`product-d2g59zty74d7d1ec1`
- path：`D:\codex\coding\yidian-miniprogram\cloudfunctions\jiancheng_daka_features`
- remote-npm-install：true
- 最后状态：pending；未主动轮询，未重发。

按 wechatide-skill 的云写确认规则，通知用户在开发者工具确认后暂停该步骤。恢复时先用 polling_task_result 查询这个旧 taskId，再按最终结果决定是否继续，不能直接重发。其余三个新函数尚未发起部署，旧主函数/配置/数据库未改。尚未验证任何新函数部署成功。
