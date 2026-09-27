# 一次性提醒启用清单

本文件是待执行部署设计，不是线上验收记录。当前提醒默认关闭，没有发出真实消息。

## 资源和配置

- 认证请求复用 `jiancheng_daka_features`，发送只用 `jiancheng_daka_reminder_tick`，集合 `jiancheng_daka_reminders` 和 `jiancheng_daka_limits`，不得修改共用认证或其他小程序资源。
- reminders 客户端 deny-all；索引 `status ASC,dueAt ASC` 和 `status ASC,claimedAt ASC`，以及删除清理的 `owner,ownerEpoch`。`expiresAt` 为真实数据库 Date，TTL 到期后清理，延迟以平台为准。
- 若环境不支持可靠 TTL，先补本应用有界清理任务并验证，不能仅设置 `HABIT_REMINDER_TTL_VERIFIED` 让记录无限累积。
- 模板须匹配个人主体和习惯提醒场景，具备一项 thing、一项 number、一项 time 字段；后台字段需分别映射 `HABIT_REMINDER_FIELDS` 的 text/count/time。无匹配模板时需调整适配器，不能借用无关交易模板。
- `HABIT_REMINDER_TEMPLATE` 为公开模板 ID（客户端预览从服务端取得），`HABIT_MESSAGE_STATE` 明确为 developer/trial/formal；未验收不得填 formal 后声称可用。
- `HABIT_REMINDER_KEY` 与 `HABIT_TIMER_SECRET` 是不同的随机 32 字节 hex 密钥，仅在服务端环境配置。前者加密接收者，后者需在对应定时器私有 Message 配置一致。不得写入 Git、客户端、截图、命令输出或日志；定时配置读取权限仅给管理员。
- `HABIT_TIMER_NAME` 必须为 `jiancheng_daka_` 前缀名称并与定时器完全一致。不凭可伪造的 Type/名称认证；附加凭据 constant-time 比较，拒绝有微信用户/HTTP来源的请求。
- 私有请求限流 `HABIT_REMINDERS_LIMIT_MINUTE/DAY/USER_MINUTE/USER_DAY`；独立发送额度 `HABIT_SEND_LIMIT_MINUTE/DAY`。认领后额度不足不重发。每批最多 20 项、函数主动处理预算 25 秒、单次外部请求等待 5 秒；总函数超时必须留出认领/状态落库余量。

## 持久门禁和停止开关

提醒入口需要 `HABIT_REMINDERS_ENABLED`、`HABIT_REMINDER_STORAGE_READY`、`HABIT_TEMPLATE_VERIFIED`、`HABIT_TIMER_VERIFIED`、`HABIT_REMINDER_TTL_VERIFIED` 及已有身份/限额/主账户旁路清理门禁均为 true。

`HABIT_REMINDERS_ENABLED=false` 用于停止申请和发送。**即使停止功能，`HABIT_REMINDER_STORAGE_READY=true` 仍须留在主账户 API，继续清理已有提醒。** 删除清理不能随着产品入口关闭而关闭。密钥轮换前先停申请并处理旧 pending；否则旧记录会无法解密但不会伪报发送成功。

## 调度部署选择

设计需要北京时间 08:00、12:30、20:30。平台实际时区必须先测。当前 CloudBase CLI 文档称每函数只支持一个触发器；不能直接假设能挂三个。可以用单个固定组合 cron 覆盖 `08:00/08:30/12:00/12:30/20:00/20:30`，其中非目标时段查不到新到期项；这样每天六次有界查询，不是每五分钟全表扫描。已错过 15 分钟有效窗口的任务只取消不补发。若超过单批容量，先量测并扩展受控调度，不承诺所有排队消息必达。

SCF 支持自定义 Message，但本共享环境控制台是否暴露该配置仍需核验；不支持则保持功能关闭，另行设计可信调度身份，不能去掉认证。禁止公开 HTTP 或小程序直调发送函数，只给定时器受限执行权限。

## 外部验收（全部待完成）

- 两个真实微信账户分别申请/查询/取消，不互见；资源方与使用方身份/发送目标必须正确，不猜 FROM 字段。
- 前端只在点击时弹授权；accept 后写入，reject 不写；断网后同请求登记重试，刷新不申请新订阅。
- 今天/明天/每周计划、北京时间午夜、跨设备完成后不发；账户删除后 pending 不发，已在途不能承诺撤回。
- 真机收到对应模板，点击到今日；平台成功与真实送达分开记录；Android/iOS 均验。
- 重复触发、发送超时、进程终止和落库失败不重复发送；认领残留变 unknown。
- 私有集合权限、TTL 日期类型与清理、索引、平台并发/费用告警、密钥轮换和停服演练。

## 官方依据

- [订阅消息云函数示例](https://docs.cloudbase.net/recipes/add-subscribe-message-cloud-function)：授权和服务端发送调用，实际主体/模板资格需后台确认。
- [SCF 定时触发事件与 Message](https://cloud.tencent.com/document/product/583/9708)：定时事件可带自定义 Message；事件外形本身不是认证。
- [CloudBase 云函数配置](https://docs.cloudbase.net/cli-v1/functions/configs)：运行时和当前单函数触发器限制，2026-09-27 查阅。
