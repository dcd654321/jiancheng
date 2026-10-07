# AI 计划增强启用清单

2026-10-02 更新：客户端开关、助手入口和云函数独立产品开关已在本地 dev 开放，`HABIT_AI_ENABLED=false` 可关闭。其余身份/目录/清理验证门禁和真实密钥/预算配置继续必需；本轮没有部署或真实模型调用。当前 UI 与验证记录见 [AI开放与交互优化](AI-UI-OPTIMIZATION-20261002.md)。

本轮只完成本地实现和模拟验证，没有真实模型请求或付费，也没有选择/购买套餐。现有基础建议离线可用，AI 失败不影响打卡。

## 功能与数据

认证函数 `jiancheng_daka_plan`，私有集合 `jiancheng_daka_ai_requests`（文档键 owner）与 `jiancheng_daka_ai_budget`（global），均拒绝客户端直接读写。已有 `jiancheng_daka_limits` 提供请求频控。

前端只在用户本次同意后发送 direction/minutes/weekdays/time 到本应用云端。模型仅收到 direction/minutes 和固定可选动作，不收到执行时间、星期、账户标识、历史习惯或备注。

模型只选择 actionKey/reasonKey/target/minimum；结果必须在方向匹配的固定动作目录内，整数目标不超过本次可用时长。界面文案由审核目录构造，不直接展示供应商任意文本；`safetyMode=allowlist-v1` 不是微信平台内容审核凭证。未来若允许自由文案，必须另加合规审核流程，不能沿用这个安全标记。

用户回执含 owner/ownerEpoch、当天次数、最多 32 条 id/fingerprint/day/status/startedAt/selection。不得存原始输入/模型响应/密钥。全局预算不含用户 ID；主账户删除清理本人的 AI 回执，不退还已经预留的全局额度。

## 配置（均不在客户端放密钥）

- `HABIT_AI_PROVIDER=deepseek` 是当前唯一适配器；若用户选其他厂商先加适配并重验，不把别家密钥发送到这个固定地址。
- `HABIT_AI_MODEL` 使用实际账号可用且经过评估的非思考模式模型名；代码不固化可能过期的型号和价格。
- `HABIT_AI_API_KEY` 只填服务端环境变量；不得发到聊天、Git、截图或日志。当前代码固定 HTTPS `api.deepseek.com/chat/completions`，不接受客户端 URL，不跟随重定向。
- 生成参数：非流式 JSON、关闭思考、最大 512 输出 token、HTTP 最多等待 8 秒、响应最大 32 KiB、结果正文最大 1 KiB。空内容、截断、格式错误、未知目录和越界目标不产生可采用建议。
- `HABIT_AI_USER_DAILY`：1–10 次；`HABIT_AI_RESERVATION_MICRO_CNY`：每次最大预留金额；`HABIT_AI_DAY_MICRO_CNY` 和 `HABIT_AI_MONTH_MICRO_CNY`：全局日/月上限。金额单位是百万分之一元，**不是** token。
- 部署时用实际模型最高非缓存输入价格、固定提示词最大输入长度、512 输出上限和服务商计费规则算出保守每次预留；不得把示例数字当价格或自动启用。月/日预算有界但依赖预留估算正确，不能保证供应商总账单；仍须开供应商侧消费上限/告警。
- `HABIT_AI_LIMIT_MINUTE/DAY/USER_MINUTE/USER_DAY`：额外请求限流；这不替代实际生成次数与费用预算。

## 门禁与恢复

独立产品开关默认开放，`HABIT_AI_ENABLED=false` 停止申请；入口仍要求 `HABIT_AI_STORAGE_READY`、`HABIT_AI_BUDGET_VERIFIED`、`HABIT_AI_CATALOG_VERIFIED` 以及现有身份/小程序专属调用/限流/旁路清理门禁全部为 true。客户端还需 AI 开关及受支持的主 API；旧 habitApi 环境不调用新 AI。

先事务预留，再调用模型；同 operationId/指纹只付费尝试一次，成功重复返回同结果，pending/unknown 不再调用。失败和超时不退还预留，避免实际已计费时放大开销。超过 90 秒的在途回执只可标 unknown；新的明确操作可用剩余额度，但原请求永不重发。

客户端同一会话、同输入、同日复用请求。小程序进程重启后再次明确生成可视为新请求，日额度仍会限制；不宣称跨卸载永久去重。已成功结果回看会复用，不提供付费“换一个”连点行为。

停止 AI 时关 `HABIT_AI_ENABLED` 和客户端开关；**主 API 仍保留 `HABIT_AI_STORAGE_READY=true` 和清理代码**，直到已有用户回执均可正确删除。迟到结果不能重建已删记录，已发送给供应商的请求无法撤回。

## 外部验收（未完成）

- 确认供应商选择、模型、隐私处理条款和预算，密钥只在服务端填写。
- 本应用身份/共享来源、私有集合规则、平台限额及清理验证。
- 实际 1/2/5/30/60 分钟、四方向、授权拒绝、弱网、重复点击与账户删除；结果有效率/延迟/成本量测。不得只凭 JSON 模式认定产品效果合格。
- 对比无 AI 的基础建议确实有可感知收益；若没有，先不启用 AI，不把随机变化当价值。
- 实際供应商消费记录与最大预留测算相符；真正预算阻断及停服验证。

依据：[DeepSeek JSON 输出说明](https://api-docs.deepseek.com/zh-cn/guides/json_mode/)、[接口字段与截断原因](https://api-docs.deepseek.com/zh-cn/api/create-chat-completion/)，2026-09-27 查阅。未引用旧模型报价作为当前事实。
