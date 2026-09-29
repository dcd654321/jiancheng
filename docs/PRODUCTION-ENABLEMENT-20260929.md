# 正式功能启用推进记录（2026-09-29）

## 目标与范围

用户要求推进现有功能正式可用，分享内容、朋友圈分享、一次性提醒不是产品下线项；仅 AI 建议继续关闭。工作在 dev，不合并 main，不发布小程序，不迁移测试账户数据。原有未提交设计文档保持不动。

本轮尚未修改远端。活动客户端仍指向测试环境，避免在共享初始化失败时令整个小程序无法打开。

## 当前证据

1. 当前渐成运行时执行 `new wx.cloud.Cloud({ resourceAppid, resourceEnv }).init()`，目标为资源方 `wx7ad85943fe81e095` 的 `product-d2g59zty74d7d1ec1`。Promise 返回 `errCode: 403`、`当前小程序未获得备婚待办云环境的共享权限`。没有调用业务函数，没有读写正式账户。
2. 通过开发者工具项目列表定位资源方本机工程 `D:/codex/todoList/weddingTodo`，只读查看 `cloudfunctions/cloudbase_auth/index.js`：允许名单来自 `SHARED_CLIENT_APPIDS`，缺省只有监控小程序；拒绝文案与实时 403 一致。所有允许来源均被赋予 `role: monitor`、`canReadAnalytics: true`、`canCallMonitorApi: true`。
3. 这是高度相关的本机源码证据，**尚未证明线上代码和环境变量与本机完全相同**。不能直接宣称已读到正式认证配置。修改前还需核对正式版本并备份。
4. 正式控制台 `jiancheng_daka_features` → `$LATEST` → 配置 → 高级配置，当前超时 3 秒，环境变量只有空白输入行，没有已配置变量。仅查看，没有点击确认保存。
5. 本应用 `server/identity.js` 仅使用 APPID/OPENID/SOURCE；共享来源适配任务尚未完成。`server/reminders.js` 接收者取 OPENID；`server/reminder-worker.js` 发送使用默认 openapi，需与真实共享来源及模板所属小程序一起核实，不能只开布尔开关。

## 已修复的本应用问题

- 主 API 停用提示删除“本机功能不受影响”，与全部云端保存的实际行为一致。
- 数据库初始化、上下文读取等进入业务 handler 之前的 SDK 异常，返回脱敏的 SERVICE_UNAVAILABLE；不向客户端抛出底层配置/身份信息。
- 复用既有 businessEvent 过滤平台元数据，保留非法输入和未知业务字段的校验。
- 新增两个回归测试：关闭状态文案、数据库/身份异常的安全返回及故障解除后的重试。

以上改动尚未上传云端，不能称为线上修复。

验证：`npm test` 276/276；复用 businessEvent 后入口专项测试 7/7；`npm run check` 293 项通过；`npm run check:cloud` 61 个生成文件一致；OpenSpec 严格校验 12/12；`git diff --check` 无空白错误。以上均为本地验证，不代表共享正式环境联调或提醒消息送达。

## 阻塞与解除顺序

### 1. 共用认证（需扩展到共用资源的明确授权）

本项目原范围明确不修改 cloudbase_auth。已请求允许：只为渐成增加独立授权，保留其他应用原权限，先备份。

不能仅把渐成 AppID 加到现有 SHARED_CLIENT_APPIDS：该实现会返回监控角色和监控能力标记。应使用精确 AppID 的独立分支、独立角色，并核对实际使用 auth 的数据库/存储规则及函数授权范围；默认拒绝未知来源，不授予其他应用数据权限。若线上实现不同，按线上已备份版本做最小差异，不覆盖为本机旧代码。

### 2. 身份与私有数据验证

共享 init 成功后，以本应用受控请求确认受信上下文中来源小程序和用户字段，输出仅包含匹配结果，不输出 OpenID。再落实身份适配、双来源拒绝及账户隔离测试。不得把 event.userInfo/event.tcbContext 当身份。

### 3. 分享配置与验收

`jiancheng_daka_features` 需要 HABIT_FEATURES_ENABLED、HABIT_IDENTITY_VERIFIED、HABIT_SIDECAR_CLEANUP_ENABLED、HABIT_LIMITS_VERIFIED、HABIT_MINIPROGRAM_ONLY、HABIT_APP_ID 及 HABIT_FEATURES_LIMIT_MINUTE/DAY/USER_MINUTE/USER_DAY。

`jiancheng_daka_public_share` 需要 HABIT_PUBLIC_SHARES_ENABLED、HABIT_SIDECAR_CLEANUP_ENABLED、HABIT_LIMITS_VERIFIED 及 HABIT_PUBLIC_LIMIT_MINUTE/DAY。

主 API 要同时启用已验证的旁路清理与对应存储标记，避免删除账户后遗留分享。先核对 deny-all 集合规则、普通索引和真实清理，再启用服务端，验收创建、本人列表、公开读取、撤回失效、跨用户隔离。最后开启客户端分享/朋友圈入口。VERIFIED 变量是验证结果，不可为了绕过门禁直接填 true。

### 4. 提醒配置与验收

除分享入口外，还需模板及字段映射、接收者加密密钥、定时器凭据、受限触发器、Date TTL 或有界清理、请求和发送配额。详见 REMINDER-DEPLOYMENT-20260927.md。密钥只能进入服务端配置，不写入仓库或记录。

当前 worker 处理预算 25 秒，不能以现有默认 3 秒函数超时作为完成配置。需设置合理执行余量并验证重复触发不重复发送、超时状态准确、取消/完成后不再发送。模板资格和真机实际收信必须真实验证，不用模拟测试代替。

## 回滚边界

本轮本地变更只涉及主函数入口、本入口测试和本记录。Git 差异可逐文件审阅/回退；不覆盖原有未提交设计文档。没有改共用认证、云配置、数据库、定时器、AI 开关或客户端环境。

后续正式变更需保存本应用函数版本与配置、共用认证原版本；代码回滚不等于数据回滚，不能删除正式集合或隐式切回测试账户。

## 2026-09-29 共享认证推进

用户明确允许修改 product 的共用 `cloudbase_auth`，仅为渐成增加独立授权并保留其他小程序权限。实际线上核验：函数状态 `UpdateFailed`，`$LATEST` 占 100% 流量，最近更新时间 2026-09-28 10:11:26，Nodejs16.13，3 秒超时，环境变量为空；资源方控制台的环境共享条目已包含渐成。已通过控制台将当前 `$LATEST` 发布为不可变版本 `1`（备注：渐成接入前备份；保留监控调用方原有配置），发布成功，未改流量。

资源方工程 `D:/codex/todoList/weddingTodo/cloudfunctions/cloudbase_auth/index.js` 只增加精确的渐成 AppID 分支，返回独立 `jiancheng_daka` 角色；原监控分支不变。该工程 `tests/cloudbaseAuthShared.test.js` 2/2 通过，分别覆盖渐成无监控标记、原监控调用方保持权限、未知来源与伪造 event 被拒绝。资源方其他未提交改动未触碰。

已发起唯一一笔精确目标的部署：资源方 AppID `wx7ad85943fe81e095`、环境 `product-d2g59zty74d7d1ec1`、函数目录 `D:/codex/todoList/weddingTodo/cloudfunctions/cloudbase_auth`。微信工具返回 `pending`，任务号 `confirmation_cloud_fn_deploy_c8e264e1-79c6-48e7-b578-9f79b43d38a4`，正在等用户在开发者工具确认。**pending 不表示部署成功；不得重发。** 用户确认后查询此任务的终态和内层结果，再复测共享 init 与监控来源。
