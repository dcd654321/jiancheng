# 好友监督、照片打卡与下一次提醒：实施及验收

逐函数变量取值、后台配置步骤、索引和两个定时器的操作清单见[测试环境配置清单](friend-supervision-setup.md)。

## 入口与操作

- 今日页保留普通一键打卡。有效约定要求照片时，原打卡按钮打开底部面板；选择平时或忙时目标后上传 1—3 张照片，再提交同一次云端打卡。
- 今日已完成行可进入照片页补充、更换或删除当天照片。必传约定删除最后一张需确认同时撤销打卡。详情页继续只读打卡状态。
- 习惯详情现有操作区域提供“邀请监督”。邀请默认 7 天、截止 21:00、照片选填，可选 14/30 天及必传照片。
- 邀请落地页先申请，本人再确认申请人。邀请有效期 48 小时；每个习惯最多一位监督人。已完成的当天记录不因新约定开放给对方。
- “我的 → 好友监督”分别查看“我监督的／监督我的”。双方可结束约定；截止与照片规则调整次日生效；到期不自动续约。
- 两类提醒各自预约并各自授权。预约页显示日期、时间和涵盖事项；同一接收者每实际发送日每类至多一次。照片处理中已算完成。

## 接口与事务

业务函数 `jiancheng_daka_features` 增加监督与媒体动作。请求的账户 `epoch` 用于代际检查，身份只取受信微信上下文。所有动作拒绝范围以外的字段和过量输入。

| 对象 | 动作 | 输入与结果 |
|---|---|---|
| 邀请 | `createSupervisionInvite`、`getSupervisionInvite`、`applySupervision`、`confirmSupervision` | 习惯、期限、截止、照片要求及可选称呼；返回邀请或确认后的约定。写入携带 `operationId`，确认在事务内核验双方代际及唯一监督关系。 |
| 约定 | `listSupervisions`、`getSupervision`、`updateSupervision`、`endSupervision` | 约定 ID、版本及调整规则；每次读取重新核验关系和双方账户。结果只含约定摘要及生效范围内的打卡投影。 |
| 鼓励 | `encourageSupervision` | 完成日期及固定 `encourage`；同一日期至多一条站内鼓励。 |
| 照片准备 | `prepareMedia` | 习惯、当天日期、JPG/PNG 格式、操作 ID；返回本账户代际下的暂存路径。 |
| 上传确认 | `confirmMedia` | 准备 ID 和文件 ID；服务端读取真实字节，校验格式及 2 MiB 限制，再冻结到仅服务端可写的路径。 |
| 照片读取 | `getRecordMedia` | 本人习惯或已授权约定 ID、日期；照片链接有效期至多 300 秒。监督人只获得检查通过的照片链接。 |
| 照片修改 | `updateRecordMedia` | 当天习惯、版本、媒体 ID 列表及操作 ID；附件替换和必要的撤销与账户修订同事务提交。 |
| 打卡 | 原核心 `complete`、`completeMinimum` | 可带 `mediaIds`；服务端在原账户事务中核验必传规则并绑定附件。旧客户端缺少附件时也无法绕过规则。 |
| 下一次提醒 | 原 `previewReminder`、`scheduleReminder`、`cancelReminder`、`getReminders` | 新增 `self`/`supervisor` 类型、检查日期、任意合法时刻和涵盖习惯/约定；服务端生成范围指纹。两类使用分别核验的订阅模板。 |

预约提醒先由接收者主动授权。发送前与认领后均重新检查实际计划、生效规则、双方代际和完成状态。已完成、休息、关系结束和失效事项不发送；未知发送结果保留 `unknown`，不自动重发。

图片系统检查通过 `jiancheng_daka_media_callback` 接收平台 AES 加密及签名回调；伪造客户端和未签名 HTTP 均不能改变检查状态。`jiancheng_daka_media_tick` 只接受受信定时器，处理待检查图片、超时检查及 24 小时孤立媒体清理。核心删除事务结束监督关系，随后按旧账户代际清理邀请、关系、私有索引、图片、绑定与检查 trace，并移除另一方索引中对应条目及回执；保留另一方本人打卡和新账户代际的数据。

## 唯一源码与构建

领域源码位于 `server/supervision.js`、`server/media.js`、`server/next-reminders.js` 及对应仓库、provider、worker；云函数入口统一来自 `server/entries/`。客户端页面、服务与独立功能开关位于 `miniprogram/`。

`npm run build:cloud` 生成 `cloudfunctions/`。不得只修改生成副本。`npm run check:cloud` 对比源码与全部生成文件。

## 资源及开放条件

`deploy/product-resources.json` 列出本应用 7 个函数、13 个集合和图片路径。所有数据库集合拒绝客户端直接读写。新索引参数在 `deploy/indexes/media.json`、`media_bindings.json` 与 `media_traces.json`；原提醒索引及 TTL 条件保持有效。

照片暂存区为 `jiancheng_daka_media/uploads/`，冻结记录区为 `jiancheng_daka_media/records/`。`deploy/media-storage-rules.json` 是专用存储规则样例，客户端只可写创建者匹配的暂存路径，不能直接读图片或写冻结区。共享环境存储规则作用于整个存储桶：先导出现有规则，核实共享上传的认证身份，再将该路径条件合入既有规则；不可把样例直接覆盖到其他应用仍在使用的存储桶。未核验前保持私有存储开关关闭。[CloudBase 存储规则](https://docs.cloudbase.net/storage/security-rules)

2026-10-14 配置简化：原18项新增环境变量缩减为5项平台配置。重复的启用/已核验变量已移除；资格、权限和真机证据记录在验收清单。服务端默认配置集中在 `server/supervision-config.js`：

| 代码配置 | 默认值与用途 |
|---|---|
| `storageReady` | `false`；新增集合、索引和必要权限完成核验后设为 `true`，核心附件守卫与账户清理开始使用新资源；之后关闭入口时继续保留 `true`。 |
| `supervisionEnabled` | `false`；取得适用主体/类目/场景确认并完成监督验收后开放。 |
| `mediaEnabled` | `false`；私有存储、平台图片检查、安全回调与定时器验收后开放。 |
| `supervisorRemindersEnabled` | `false`；监督已开放、真实模板与双账户收件验收后开放。 |

代码配置由源码构建到相关函数，无需在每个函数重复添加开关环境变量。客户端对应入口仍分别配置，服务端开启不会自动打开客户端。

仅保留以下5项新增环境变量：

| 变量 | 用途与需配置的函数 |
|---|---|
| `HABIT_MEDIA_FILE_ID_PREFIX` | 本目标环境真实 `cloud://.../` 前缀，保持文件范围校验；API、features、media tick需要。 |
| `HABIT_MEDIA_CALLBACK_TOKEN` | 微信安全回调Token；features、media callback、media tick需要。 |
| `HABIT_MEDIA_ENCODING_AES_KEY` | 微信后台43字符回调AES密钥；features、media callback、media tick需要。 |
| `HABIT_SUPERVISOR_TEMPLATE` | 监督提醒真实模板ID，与本人模板不同；features和reminder tick需要。 |
| `HABIT_SUPERVISOR_FIELDS` | 官方模板的实际字段映射JSON，含 `text`、`count`、`time`；features和reminder tick需要。 |

媒体定时器名称固定为 `jiancheng_daka_media_tick`。其Message以回调AES密钥为输入、固定用途标识 `jiancheng_daka_media_tick:timer-auth:v1` 做HMAC-SHA256派生，为64字符小写十六进制；不是AES密钥原文，也不接受提醒定时器的消息。无需新增名称或密钥环境变量。受控本机可运行 `node scripts/media-timer-message.cjs`，从标准输入提供该AES密钥并结束输入，输出派生Message；工具不读取账户、不写文件、不连接云端。派生值只配置到定时器Message，不提交Git；更换AES密钥后须同步更换Message。平台定时器仍需在目标环境配置并验收。

原有配置继续使用：

| 能力 | 原有配置 |
|---|---|
| 公共前提 | `HABIT_IDENTITY_VERIFIED`、`HABIT_MINIPROGRAM_ONLY`、`HABIT_SIDECAR_CLEANUP_ENABLED`、`HABIT_LIMITS_VERIFIED` |
| 本人提醒 | 原提醒存储、模板、定时器、TTL 与提醒开关均核验；`HABIT_REMINDER_KEY`、`HABIT_REMINDER_TEMPLATE`、`HABIT_REMINDER_FIELDS`、`HABIT_MESSAGE_STATE`、`HABIT_TIMER_NAME`、`HABIT_TIMER_SECRET` |

`HABIT_APP_ID` 绑定消费小程序，默认公开 AppID 与项目一致。媒体检查和订阅发送显式指定消费小程序 AppID，仍需实测共享资源端的接口权限。模板字段映射必须包含官方模板实际对应的 `thing`、`number`、`time` 字段；不得照搬不存在的字段或虚构模板。

客户端 `miniprogram/config/supervision.js`、`media.js` 和 `reminders.js` 独立控制入口；默认均关闭。打开这些功能不需要打开公开分享。个人主体开放好友记录及照片前，须取得本项目适用的主体、类目和场景确认。

## 测试云顺序及验收

1. 确认共享测试目标环境为 `cloud1-d8gopnalv908bb47a`，资源方及消费方 AppID 与目标配置一致。记录现有函数版本、环境变量、规则和索引作为恢复输入。
2. 获得测试云部署授权后，创建本应用新增六个集合与索引，合入限定照片路径的存储规则；保留其他小程序资源与 `cloudbase_auth` 原配置。
3. 上传由源码构建的核心 API、features、提醒 tick、媒体 callback 和媒体 tick。配置安全回调、固定名称媒体定时器及派生Message、两类消息模板与加密密钥。新增资源准备完成后，将代码 `storageReady` 设为 `true` 并重新构建部署，保持其他三个新入口开关为 `false`；完成各能力的平台、权限和真机验收后再按授权开放对应代码及客户端开关。私有签名、回调检查和清理在验收时逐项验证。
4. 以两名真实用户分别建立邀请、申请、确认，验证转发、重复接受、过期及一习惯多人竞争。检查非成员、关系结束、账户删除及链接过期后均不能重新读图。
5. Android/iOS 真机验证普通一键、必传底部面板、忙时完成、1—3 图、压缩上限、上传失败、云事务失败、未知重试、跨日和账户切换。验证在不同入口撤销、删除及清空后附件不可继续读取。
6. 双方各自预约、各自授权，验证拒绝仍能使用、完成后不发送、到点检查和真实收件。平台接受请求、终端送达与用户已读分别记录。
7. 找 5 对熟人试用 7 天；至少 4 对无需讲解建立约定，普通打卡一步完成，监督人 10 秒内找到谁、哪项、何时未完成。记录授权拒绝、提醒后行动、退出原因和是否愿继续使用。
8. 用户完成验收后再授权正式开放。提交、推送、正式部署、合并与发布分别执行并保留回执。

## 回退

关闭客户端新入口，将代码 `supervisionEnabled`、`mediaEnabled`、`supervisorRemindersEnabled` 设为 `false` 后构建并部署相关函数，同时关闭原 `HABIT_REMINDERS_ENABLED`，停止新的关系、上传及预约。保留已有账户和附件数据。关闭照片提交前，先由双方结束仍有效的必传约定，或保留其提交能力直至约定结束；直接关闭会使这些约定的未完成打卡继续被服务端拒绝。

保留代码 `storageReady: true`、事务守卫以及账户删除清理；已有必传约定不能因为关闭入口而被旧客户端绕过。保留安全回调Token/AES密钥、原身份与清理配置、文件前缀及媒体定时器，使已提交附件能够结束检查或清理。恢复任意更旧核心版本前，必须确认已没有有效必传约定及该版本能安全处理附件；不得仅覆盖旧核心函数。

清理或迁移真实数据前单独说明精确对象、影响和恢复边界并取得授权。

## 本地验证记录

2026-10-13 在 `dev` 完成本地实现。开始时同步 `origin/dev`，已是最新；保留用户原有 `.claude/` 和 `qa/` 未提交文件。

| 检查 | 实际结果 |
|---|---|
| `npm test` | 588/588，通过；0失败、0跳过。包含已安装锁定 `wx-server-sdk` 的事务、存储与消费者AppID接口编码合同。 |
| `npm run check` | 509 项语法、配置和页面检查通过；活动客户端无设备持久账户读写。 |
| `npm run build:cloud` / `npm run check:cloud` | 117 个云产物已生成并与唯一源码一致。 |
| `npm run openspec -- validate --all --strict` | 24 项全部通过。 |
| 微信开发者工具原生编译 | `wcc.exe` 20个输入通过；`wcsc.exe` 19个输入通过。 |
| 页面验证 | 17个注册页面的生命周期和事件合同通过；新监督、必传面板、鼓励、图片编辑和授权流程连接本地域API验证。未取得原生模拟器视觉证据，9431自动化端口未开放。 |

客户端监督、照片和提醒开关保持 `false`。未执行云部署、存储规则应用、生产数据变更、真实接口收件、Git提交/推送或main合并。测试云、双账户、Android/iOS真机、熟人试用及用户验收未执行，OpenSpec 对应任务保留未勾选。

### 2026-10-14 配置简化验证

新增环境变量从18项缩减为5项。服务端4个代码配置及客户端新入口均保持关闭。保留工作区原有运营监控等未提交修改，未编辑其源码；重新构建同步当前唯一源码。

| 检查 | 实际结果 |
|---|---|
| `npm test` | 当前工作区598/598，通过；0失败、0跳过。包含默认关闭、旧环境开关不放行、缺少图片配置、无效监督模板映射、定时器认证与密钥轮换、派生工具输入及原SDK/图片签名合同。 |
| `npm run check` | 516项通过。 |
| `npm run build:cloud` / `npm run check:cloud` | 122个产物已生成并与源码一致；新增代码配置同步到5个相关业务函数。 |
| `npm run openspec -- validate --all --strict` | 24项全部通过。 |

本轮无WXML/WXSS修改，未重复原生编译、模拟器或真机验证；未创建云资源、配置定时器或修改云环境变量，未部署、提交、推送或合并。

### 2026-10-14 授权后的测试云准备

用户随后授权代为完成可配置项目，并完成CloudBase登录。本阶段已部署五个渐成函数至共享测试云，创建六个专属空集合与九个图片索引，配置已核实的文件前缀及回调密钥，并经用户单独确认创建独立图片回调HTTP路由。详细配置、回执、未完成项和恢复输入见[测试云执行记录](friend-supervision-test-setup-20261014.md)。

当前工作区验证为613项自动测试、518项配置检查、122个云产物一致性和24项OpenSpec严格校验通过。部署后下载云端代码逐文件比对；核心API出现本地启动优化差异后已重新部署测试云并复查Active，五个函数的上传业务文件均与当前本地一致。

测试云当前套餐不支持自定义存储安全规则，尚未配置符合要求的私有照片访问；CloudBase触发器编辑器未提供认证Message输入，标准SCF控制台未找到对应微信云函数命名空间。两类真实订阅模板、微信消息推送后台接线、双账户与真机验收尚未完成。对应OpenSpec任务保持未勾选；客户端和服务端开关继续关闭。未执行正式部署、Git提交/推送或main合并。
