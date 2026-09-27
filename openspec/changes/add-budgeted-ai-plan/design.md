# Design

## Structured enhancement

只接受 direction/minutes/weekdays/time，服务端验证严格字段及类型；模型只看到 direction 和可用分钟，不需要个人身份、已有习惯、备注、职业或执行时间。输出仅 actionKey/reasonKey/target/minimum 四字段，按方向允许目录、1–可用分钟、合法忙时目标校验。展示文本从服务端审核目录构造，额外字段/截断/空内容/错误方向一律拒绝。`moderated=true` 仅表示受限目录/结构安全校验，新增 `safetyMode=allowlist-v1`，不冒充平台内容审核通过。

## Idempotency and budget

每 owner/epoch 单文档，存有限回执（最多 32，单日次数最多 10），不存原始输入/模型文本；请求含 operationDate。新请求只能当前北京时间日，旧请求只可重放现有回执。相同 operationId/指纹成功返回已存建议，claimed/unknown 不再调用供应商，失败不自动再付费。

同一事务读账户、用户回执和全局预算；检查用户次数、日/月最大预留金额，先写 claimed 和最大费用预留再出网。失败/未知不退回预算，防止超时其实已计费时超支；预留为保守估计，不是供应商最终账单。每次预留值须按当时输入/输出上限和最高非缓存价格填写，预留或模型价格不确定就不开启。云调用和数据库账单仍由平台配额另限。

模型最多等待 8 秒、响应 32 KiB、输出上限 512 token、禁止重定向和客户端自定 URL/模型。默认不发请求，供应商适配不记录 header/body/原始响应。DeepSeek 官方 JSON 文档 https://api-docs.deepseek.com/zh-cn/guides/json_mode/ 和接口 https://api-docs.deepseek.com/zh-cn/api/create-chat-completion/ 于 2026-09-27 查阅；模型名作为服务端配置，不能由旧型号或样例推定当前资格和价格。

## Failure and lifecycle

事务外出网前重新检查账户/删除代际；结果返回时再验 epoch。删除立即使旧请求失效，迟到结果不会重建已删除的回执。保留 `HABIT_AI_STORAGE_READY` 独立清理门禁，关产品不关删除。记录只保留最多 32 条当前代际回执，超出时只清理往日非在途记录，同日幂等不淘汰。

客户端进程内为相同输入保存原 operationId/date；超时或网络错误再次主动点击复用，未知结果不发新付费请求。改输入属于新的明确生成操作；服务端用户/预算上限仍生效。页面离开或账号变化不展示迟到结果，不向模型发送账户标识。
