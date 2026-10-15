# 好友监督与照片打卡：测试环境配置清单

先配置共享测试环境 `cloud1-d8gopnalv908bb47a`。正式环境 `product-d2g59zty74d7d1ec1` 在测试验收后单独配置；两环境的文件前缀、URL、定时器和函数配置分别保存。

| 对象 | 值 |
|---|---|
| 渐成小程序 AppID | `wx58e61dffcbfa4249` |
| 共享云资源方 AppID | `wx7ad85943fe81e095` |
| 业务函数、数据库、存储、定时器所在环境 | 上述共享测试环境 |
| 图片检查消息推送、订阅模板所属账号 | 渐成小程序账号 |

## 1. 准备新增五项环境变量

| 变量 | 具体填法 |
|---|---|
| `HABIT_MEDIA_FILE_ID_PREFIX` | 在目标环境云存储中复制一个文件的完整文件ID，截取 `cloud://` 到文件路径开始前的最后一个 `/`。例如文件ID为 `cloud://环境.桶标识/photos/test.jpg`，填写 `cloud://环境.桶标识/`，保留结尾斜杠，不带 `photos/test.jpg`。没有文件可在测试环境通过控制台上传非敏感测试图片后取ID。该值不是环境ID或HTTPS图片链接。 |
| `HABIT_MEDIA_CALLBACK_TOKEN` | 自己生成32字符随机字母数字Token，同时填写到渐成消息推送Token与相关云函数环境变量。可在受控本机用 `node -e "console.log(require('node:crypto').randomBytes(16).toString('hex'))"` 生成。 |
| `HABIT_MEDIA_ENCODING_AES_KEY` | 在渐成后台消息推送设置中生成43字符EncodingAESKey，原样复制；不加引号或结尾 `=`。若已有消息推送配置，先保留其现值并核对接入方式。 |
| `HABIT_SUPERVISOR_TEMPLATE` | 在渐成后台订阅消息中，选择本账号确实可用、符合监督未完成提醒场景的模板，添加后复制完整模板ID；必须与本人提醒模板不同。 |
| `HABIT_SUPERVISOR_FIELDS` | 按模板详情实际字段填JSON：`text`对应描述类thing字段，`count`对应数量number字段，`time`对应时间time字段。 |

例如模板详情实际显示 `thing1`、`number2`、`time3` 时，字段映射填写：

```json
{"text":"thing1","count":"number2","time":"time3"}
```

这个例子只适用于相同的字段。若后台没有符合场景且包含上述三类字段的可用模板，先保持监督提醒关闭，不能填写其他场景模板或虚构ID。

环境变量添加位置为对应云函数的配置/环境变量；变量名和值分别填写。具体分布如下：

| 云函数 | 本轮需新增的变量 |
|---|---|
| `jiancheng_daka_api` | `HABIT_MEDIA_FILE_ID_PREFIX` |
| `jiancheng_daka_features` | 五项全部 |
| `jiancheng_daka_media_callback` | `HABIT_MEDIA_CALLBACK_TOKEN`、`HABIT_MEDIA_ENCODING_AES_KEY` |
| `jiancheng_daka_media_tick` | `HABIT_MEDIA_FILE_ID_PREFIX`、`HABIT_MEDIA_CALLBACK_TOKEN`、`HABIT_MEDIA_ENCODING_AES_KEY` |
| `jiancheng_daka_reminder_tick` | `HABIT_SUPERVISOR_TEMPLATE`、`HABIT_SUPERVISOR_FIELDS` |

同一回调的Token和AES密钥在相关函数与渐成后台保持一致。Token、AES密钥和定时器Message只填后台或受控终端，不需要发到聊天或提交Git。

## 2. 创建新增集合及索引

在测试环境数据库中创建以下六个空集合；已有同名集合先核对用途和权限，不清空或覆盖。

```text
jiancheng_daka_supervision_invites
jiancheng_daka_supervisions
jiancheng_daka_supervision_indexes
jiancheng_daka_media
jiancheng_daka_media_bindings
jiancheng_daka_media_traces
```

六个集合均设为客户端不可直接读写，规则为：

```json
{"read":false,"write":false}
```

为图片集合添加9个非唯一索引，所有字段升序：

| 集合 | 索引字段组合 |
|---|---|
| `jiancheng_daka_media` | `owner + ownerEpoch`；`status + checkState`；`status + checkStartedAt`；`bound + validatedAt`；`status + createdAt`；`orphanedAt`；`deleteRequested` |
| `jiancheng_daka_media_bindings` | `owner + ownerEpoch` |
| `jiancheng_daka_media_traces` | `owner + ownerEpoch` |

上传参数和准确索引名称分别见 `deploy/indexes/media.json`、`media_bindings.json`、`media_traces.json`。不创建业务测试用户或真实账户样本。

## 3. 配置照片存储规则

照片路径分为：

- `jiancheng_daka_media/uploads/`：客户端只能写入本人暂存文件。
- `jiancheng_daka_media/records/`：冻结照片只允许服务端写入。
- 两个路径均不允许客户端直接读取，图片由业务云函数签发短时链接。

规则样例在 `deploy/media-storage-rules.json`。本项目使用共享存储桶，先保存既有规则，然后将渐成路径条件合入允许的路径分支；保留其他应用仍需使用的分支，同时确保它们不会放开渐成照片。不能直接用本应用样例覆盖整桶规则。共享上传身份与创建者匹配须在测试云实际验证。[CloudBase存储规则](https://docs.cloudbase.net/storage/security-rules)

## 4. 部署函数并配置图片检查回调

新增两个函数：

- `jiancheng_daka_media_callback`
- `jiancheng_daka_media_tick`

更新三个函数：

- `jiancheng_daka_api`
- `jiancheng_daka_features`
- `jiancheng_daka_reminder_tick`

源码来自 `server/`，先运行 `npm run build:cloud` 再部署生成产物。源文件中 `storageReady` 在新资源准备完成后才设为 `true`，相关函数保持一致；业务入口可继续关闭。部署及代码开关由开发步骤单独处理。

为回调函数配置可公开接收微信回调的HTTPS事件入口，建议服务路径 `/jiancheng_daka_media_callback`，允许GET和POST，由函数验证微信签名/AES；不能同时给核心API或其他业务函数开放匿名HTTP访问。入口须将方法、查询参数和请求原文传入现有事件处理器，并把函数 `statusCode/headers/body` 作为HTTP响应。[CloudBase HTTP访问说明](https://docs.cloudbase.net/cloud-function/function-calls/httpclient)

在渐成小程序账号中找到消息推送/服务器配置，填写：

| 项目 | 填写内容 |
|---|---|
| URL | 回调函数实际可访问的完整HTTPS地址，不是函数名或示例地址 |
| Token | 第1步生成的Token |
| EncodingAESKey | 第1步取得的43字符AES密钥 |
| 加密方式 | 安全模式 |
| 数据格式 | JSON |

先预填，等回调函数环境变量及 `storageReady: true` 测试云版本准备完成后，再提交验证。当前默认关闭版本会返回503，不能据此认定Token填写错误。接口须验证URL握手及真实 `wxa_media_check` 事件；没有实际检查结果前不开放照片入口。已有消息接收URL时，先确认原接收事件和转接方案，再接入图片事件，不直接替换现有接收配置。

## 5. 配置图片定时器

在 `jiancheng_daka_media_tick` 对应的触发器中配置：

| 项目 | 值 |
|---|---|
| 类型 | 定时触发器 |
| 名称 | `jiancheng_daka_media_tick`，必须一致 |
| Cron | `0 */1 * * * * *`，测试阶段每分钟执行一次 |
| 附加信息/自定义参数/Message | 下述工具输出的64字符派生值，直接填写字符串，不包JSON、不加引号 |

CloudBase定时器使用7字段Cron；SCF定时器自定义参数会进入 `event.Message`。若当前云开发界面不能填自定义参数，应在同一资源对应的SCF触发器配置中核验 `CustomArgument` 支持，不用客户端调用模拟定时器。[定时触发器说明](https://cloud.tencent.com/document/product/583/9708)

在本项目目录的PowerShell运行以下命令，本机安全输入回调AES密钥，取得派生Message：

```powershell
$jcAesInput = Read-Host '输入 EncodingAESKey' -AsSecureString
$jcAesValue = [System.Net.NetworkCredential]::new('', $jcAesInput).Password
$jcAesValue | node scripts/media-timer-message.cjs
Remove-Variable jcAesInput, jcAesValue
```

密钥原文不写入命令历史。输出的Message仅保管在触发器设置中；AES密钥改变时重新生成并更新Message。定时器执行一次后核验服务结果及真实图片处理，不打印事件原文或密钥。

## 6. 原提醒首次启用时补齐旧配置

新增五项指本轮监督/照片配置；本人一次性提醒原本默认关闭。已有的旧配置沿用，不重建密钥。首次使用提醒时需要另外补齐下面的原配置。测试云现值及配置进度见[2026-10-14测试云执行记录](friend-supervision-test-setup-20261014.md)。

| 变量 | 值 | 函数 |
|---|---|---|
| `HABIT_REMINDER_TEMPLATE` | 本人到点提醒场景的真实模板ID | features、reminder tick |
| `HABIT_REMINDER_FIELDS` | 本人模板实际的text/count/time字段映射JSON | reminder tick |
| `HABIT_REMINDER_KEY` | 独立随机64字符小写十六进制密钥；两函数一致 | features、reminder tick |
| `HABIT_MESSAGE_STATE` | 体验版填 `trial`；开发版填 `developer`；正式版填 `formal` | reminder tick |
| `HABIT_TIMER_NAME` | 新建时可取 `jiancheng_daka_reminder_tick`；已有名称沿用 | reminder tick |
| `HABIT_TIMER_SECRET` | 另一独立随机64字符小写十六进制密钥，与提醒触发器Message一致 | reminder tick |

两个独立随机密钥可分别在受控本机运行 `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` 生成。不要更换已有 `HABIT_REMINDER_KEY`，否则旧预约的加密接收者不能读取。

提醒定时器绑定 `jiancheng_daka_reminder_tick`，Cron也使用 `0 */1 * * * * *`，名称匹配 `HABIT_TIMER_NAME`，自定义Message匹配 `HABIT_TIMER_SECRET`，与图片定时器分别设置。

原预约/发送限额仍为必须配置的旧项。若没有现值，5对熟人试用可先使用以下保守上限；发送日额度需不超过账号实际可用额度。

| 函数 | 变量与试用值 |
|---|---|
| features | `HABIT_REMINDERS_LIMIT_MINUTE=60`、`HABIT_REMINDERS_LIMIT_DAY=2000`、`HABIT_REMINDERS_LIMIT_USER_MINUTE=30`、`HABIT_REMINDERS_LIMIT_USER_DAY=300` |
| reminder tick | `HABIT_SEND_LIMIT_MINUTE=20`、`HABIT_SEND_LIMIT_DAY=200` |

features原一般功能限额已有代码默认值，不必额外填写 `HABIT_FEATURES_LIMIT_*`。

若提醒集合尚未准备，创建 `jiancheng_daka_reminders`，客户端读写均拒绝；索引按 `deploy/indexes/reminders.json`。配置TTL字段 `expiresAt`（Date类型），过期秒数 `0`，由记录自身写入的截止时间决定清理，不能用普通索引代替TTL。

## 7. 沿用原身份与清理配置，完成测试接线

| 函数 | 原有配置要求 |
|---|---|
| API | 保留 `HABIT_API_ENABLED`、`HABIT_MINIPROGRAM_ONLY`、`HABIT_SIDECAR_CLEANUP_ENABLED`、`HABIT_LIMITS_VERIFIED` 及原旁表清理配置；`HABIT_APP_ID=wx58e61dffcbfa4249`。 |
| features、reminder tick | `HABIT_IDENTITY_VERIFIED`、`HABIT_MINIPROGRAM_ONLY`、`HABIT_SIDECAR_CLEANUP_ENABLED`、`HABIT_LIMITS_VERIFIED` 在对应真实权限/身份/清理核验后为字符串 `true`。 |
| media callback | `HABIT_IDENTITY_VERIFIED=true`；AppID默认绑定渐成。 |
| media tick | `HABIT_IDENTITY_VERIFIED=true`、`HABIT_SIDECAR_CLEANUP_ENABLED=true`；AppID默认绑定渐成。 |

启用提醒前，在features和reminder tick核验原 `HABIT_REMINDER_STORAGE_READY`、`HABIT_TEMPLATE_VERIFIED`、`HABIT_TIMER_VERIFIED`、`HABIT_REMINDER_TTL_VERIFIED`；对应证据成立后设为 `true`。`HABIT_REMINDERS_ENABLED` 仅在准备测试收件或正式开放时开启。公开分享开关不因新能力而开启。

后台配置准备好后，开发阶段先在测试云开启对应服务端代码和客户端测试入口，验证双账户关系、照片权限/检查、双方授权与真实收件。正式云和正式客户端继续关闭，用户验收后单独开放。主体、服务类目和场景是否适用，须以本项目后台确认结果为准。

本清单说明完整配置要求。2026-10-14已按用户授权执行部分测试云准备；实际部署、集合、索引、环境变量和回调路由结果见[测试云执行记录](friend-supervision-test-setup-20261014.md)。私有存储、带认证参数的定时器、模板及真实双账户验收尚未完成，功能继续关闭。
