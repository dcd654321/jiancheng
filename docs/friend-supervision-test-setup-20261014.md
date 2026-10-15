# 渐成好友监督测试云执行记录

## 目标与范围

执行日期：2026-10-14。分支：dev。用户授权代为配置测试云；公网回调路由另获明确确认。

| 对象 | 实际目标 |
|---|---|
| 共享测试环境 | cloud1-d8gopnalv908bb47a |
| 云资源方小程序 | 备婚待办清单，wx7ad85943fe81e095 |
| 消费小程序 | 渐成，wx58e61dffcbfa4249 |
| 存储桶 | 636c-cloud1-d8gopnalv908bb47a-1360580226 |
| 正式环境 | product-d2g59zty74d7d1ec1，本阶段未修改 |

未修改其他小程序函数、共用认证、生产用户记录；未提交、推送或合并Git。

## 已完成的资源

### 函数与配置

五个函数均已实际上传测试云，云端安装锁定依赖并独立复查为Active。共享部署使用资源方AppID和明确函数路径；部署脚本已修复`--project`覆盖`--appid`以及CLI错误文本退出码为0的识别问题。

| 函数 | 动作 | 超时 | 本阶段新增环境配置 |
|---|---|---|---|
| jiancheng_daka_api | 更新；本地启动优化出现差异后再次上传并核对 | 30秒 | HABIT_MEDIA_FILE_ID_PREFIX |
| jiancheng_daka_features | 更新 | 30秒 | 文件前缀、回调Token、EncodingAESKey |
| jiancheng_daka_reminder_tick | 更新；检查原配置为空后调整超时 | 30秒 | 未新增模板或密钥 |
| jiancheng_daka_media_callback | 新建 | 30秒 | 回调Token、EncodingAESKey |
| jiancheng_daka_media_tick | 新建 | 60秒 | 文件前缀、回调Token、EncodingAESKey |

文件前缀来自实际存储fileID：

```text
cloud://cloud1-d8gopnalv908bb47a.636c-cloud1-d8gopnalv908bb47a-1360580226/
```

三处Token和AES密钥使用同一组本机生成值，密钥及派生定时器Message保存在被Git忽略的`qa/local/supervision-setup-20261014/generated-secrets.json`，未写入本文或版本库。两项监督模板配置尚未填写。

API原有`HABIT_API_ENABLED=true`、`HABIT_APP_ID=wx58e61dffcbfa4249`、`HABIT_MINIPROGRAM_ONLY=true`均保留；features原有`HABIT_APPEARANCE_ENABLED=true`保留。原提醒tick经实际页面检查，环境变量为空、标准触发器为空，未生成或轮换旧预约密钥；原3秒超时调整为30秒并通过CLI独立复查Active。未将缺少实际验证证据的身份、清理、限额、模板或定时器核验标记设为true。

上传后通过官方DevTools CLI下载代码逐文件计算SHA256；核对API 23个、features 21个、提醒tick 22个、回调21个和媒体tick 22个上传业务文件，均与当前本地一致。此核对不包含云端安装的node_modules或后台环境变量。

### 集合与索引

已新建以下六个空集合，并逐个在实际权限页面确认“所有用户不可读写”。未写入业务样本记录。

- jiancheng_daka_supervision_invites
- jiancheng_daka_supervisions
- jiancheng_daka_supervision_indexes
- jiancheng_daka_media
- jiancheng_daka_media_bindings
- jiancheng_daka_media_traces

已创建并逐项复查九个升序、非唯一索引，保留默认索引：media的owner/epoch、pending、stalled、bound_scan、prepared、orphan、delete七项，以及bindings、traces各一项owner/epoch。完整定义见`deploy/indexes/media.json`、`media_bindings.json`与`media_traces.json`。

### HTTP回调路由

已在测试云默认域名创建并确认启用以下路由，仅关联`jiancheng_daka_media_callback`：

```text
https://cloud1-d8gopnalv908bb47a-1360580226.ap-shanghai.app.tcloudbase.com/jiancheng_daka_media_callback
```

网关身份认证、跨域设置和路径透传均关闭；身份由函数内微信加密签名及AppID校验完成。未新增核心API、features或tick的公网路由。GET/POST实际HTTP探测均返回`503`、`text/plain`、`unavailable`，与尚未开放的回调门禁一致，证明请求到达函数；这不是微信握手或图片检查验收。

## 未完成项与原因

用户在随后答复中确认“先不增加云资源费用”。后续不升级套餐，先按[无新增费用验证方案](friend-supervision-no-extra-cost.md)核查现有基础私有权限的可用性；下表中的套餐限制只说明自定义规则入口受限，不代表所有私有照片方案必然需要付费。

随后拟增加临时验证函数和一张生成测试图，用户选择“暂不新增测试资源”。验证包只在本机准备并通过四项合同检查，未部署、调用或上传测试图；当前云资源不增加该函数。照片接通及对应真实权限/链接验收继续待完成。

| 项目 | 实际观察与下一步 |
|---|---|
| 私有照片规则 | 当前套餐为“微信体验版”。点击自定义安全规则后，实际后台提示“当前版本暂不支持此功能”并要求升级。保持原“仅创建者及管理员可读写”。需先确定支持自定义规则的测试资源，再应用和实测限定照片路径的权限。 |
| 共享存储范围 | 当前页面只有整桶权限，无目录规则入口。现有模板仅适用于隔离存储，不能覆盖共享桶；升级后仍需保留其他应用路径和文件的原权限。 |
| 图片定时器 | CloudBase编辑器仅提供name/type/config的JSON，未找到CustomArgument/Message输入。微信云开发触发器页明确只支持查看和删除，完整管理需微信开发者工具。标准SCF控制台上海地区仅返回default命名空间和0函数，未找到对应微信云函数。未创建缺少认证参数的无效定时器，也未授权SCF操作共用COS等资源。 |
| 本人/监督人订阅模板 | 需要本项目后台提供两个真实模板ID及各自thing/number/time字段编号；不得虚构或共用不同场景模板。 |
| 微信后台消息推送 | 浏览器安全策略拒绝微信公众平台访问，不能通过其他浏览器、原生操作或接口绕过。需用户在后台处理；回调目前503，待存储及身份验收后才能进行启用握手。 |
| 身份、清理、限额、提醒存储/TTL | 未取得真实验证证据；相关核验标记不设置为true。 |
| 双账户与真机 | 未进行真实邀请、照片检查、权限撤销、授权/拒绝及真实收件验证；Android/iOS、5对熟人7天试用与用户验收未完成。 |

图片定时器需要名称`jiancheng_daka_media_tick`、Cron`0 */1 * * * * *`及私有文件中的64字符派生Message。官方SCF接口支持CustomArgument，但CloudBase配置格式只列name/type/config；应在支持该参数且能管理实际微信函数的接口/控制台确认后配置，不能省略认证。参考[SCF触发器接口](https://cloud.tencent.com/document/api/583/18589)、[CloudBase定时触发器](https://docs.cloudbase.net/cloud-function/timer-trigger)。

临时链接页面显示整桶默认有效时间10分钟；代码请求监督链接300秒。未改动整桶设置，实际签发和失效时间须在测试照片上验证。官方规则仅影响客户端访问，不能把后台管理员权限等同于客户端私有访问；共享路径的规则需要实际验收。[存储安全规则](https://docs.cloudbase.net/storage/security-rules)

## 验证与恢复输入

| 本地检查 | 实际结果 |
|---|---|
| npm test | 613/613，0失败、0跳过 |
| npm run check | 518项通过 |
| npm run check:cloud | 122个生成产物与源码一致 |
| npm run openspec -- validate --all --strict | 24项通过 |

服务端`storageReady`、`supervisionEnabled`、`mediaEnabled`、`supervisorRemindersEnabled`和客户端监督/照片/提醒入口均保持关闭。未因HTTP路由创建或密钥配置而开放功能。本阶段没有WXML/WXSS修改，未重复原生编译；本地测试、云部署、HTTP探测分别保留结果，均不代替双账户或真机验收。

恢复资料均位于被Git忽略的`qa/local/supervision-setup-20261014/`：

- 原API、features和reminder tick代码分别为`*-before/`；新函数没有旧代码版本。
- `api-config-before.json`、`features-config-before.json`、`reminder-config-before.json`保存各自原环境配置和3秒超时；原其他函数未更换密钥。
- `functions-before.txt`、`functions-after.txt`、`functions-final.txt`、`api-redeploy-info.txt`是函数状态回执，不是环境变量完整备份。
- `*-after/`及`jiancheng_daka_api-final/`为云端下载核对输入；`deployed-code-comparison.json`保存文件数量和差异结果；部署日志和`callback-http-probe.json`保留执行结果。
- `callback-route-created.png`、`storage-rules-package-blocked.png`分别保留路由创建和套餐限制页面。
- `wechat-backend-inputs.txt`为微信后台待填URL、Token、AES密钥、安全模式和JSON格式，标明当前503、不能提前启用。该文件含密钥，只在本机保管；主体/场景资格及两个模板仍须来自实际后台。

功能尚未开放、未产生本功能业务数据。本阶段原函数可用备份作为恢复输入；新增空集合/索引、回调路由及新函数不自动删除。任何清理仍须说明精确对象和恢复边界后按对应授权执行。后续一旦开放并产生必传约定，必须按完整回退手册保留事务守卫、附件检查和清理，不能直接覆盖更旧核心代码。
