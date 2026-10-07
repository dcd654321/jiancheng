# AI Assistant Experience

## Purpose

让用户从当前习惯创建入口获得受限 AI 建议，清楚了解数据发送与等待状态，在失败时保留输入并使用基础方案，最终自行核对目标和安排后创建习惯，同时维持账户隔离与预算保护。

## ADDED Requirements

### Requirement: Discoverable assisted creation

系统 SHALL 开放客户端 AI 开关和可达助手入口，今日任务区保持原布局，今日添加区域和我的习惯管理可打开助手。系统 MUST 保留服务端身份、目录、清理、预算和密钥前提，显式关闭产品开关时禁止 AI 请求。

#### Scenario: Open assistant
- **WHEN** 用户从今日添加区域或我的打开 AI 小目标助手
- **THEN** 可选择四方向、1至60分钟和执行安排，打开页面不会调用模型或创建习惯。

#### Scenario: Service prerequisites missing
- **WHEN** 云端前提或配置缺失
- **THEN** 不请求模型，客户端说明暂不可用并保留基础方案入口。

### Requirement: Explicit consent and recoverable generation

系统 SHALL 只在用户主动同意本次输入且点击生成后申请 AI 建议；更改输入后撤销本次同意。等待、额度用完、不可用和结果未确认 MUST 具有明确文字，基础方案在等待和失败期间仍可使用，同输入同日核对复用原请求，已成功结果在会话内直接复用。

#### Scenario: Change after consent
- **WHEN** 同意后更改方向、分钟、星期或时间
- **THEN** 旧预览失效并撤销同意，下一次发送需再次选择同意。

#### Scenario: Timeout and fallback
- **WHEN** AI 超时或仍在处理
- **THEN** 不自动发出第二次请求，用户可以立即查看基础方案，迟到 AI 不覆盖基础方案。

### Requirement: Reviewed preview and isolated lifecycle

系统 SHALL 在建议预览中直接展示来源、具体行动、平时/忙时目标及安排，采用按钮进入可编辑确认页，只有用户确认保存才创建。隐藏、卸载、跨日或账户上下文变化后，旧请求成功、失败和导航回调 MUST 不覆盖新访问；账户变化清除输入、同意与预览。

#### Scenario: Review before create
- **WHEN** 用户查看 AI 或基础建议并选择下一步
- **THEN** 打开一次性会话草稿的确认页，无自动云写入；离线或容量已满时解释原因并提供恢复或管理入口。

#### Scenario: Late response
- **WHEN** 请求发起后离页重入、跨日或账户改变
- **THEN** 迟到结果不展示、不报旧错、不导航，仍保留全局在途保护。

#### Scenario: Server rejects stale account state
- **WHEN** AI 返回账户不存在、账户 epoch 已变化或个人数据仍在删除
- **THEN** 页面撤销本次同意并提供云端重新读取入口，读取确认前停止生成及采用；失败读取、更改输入或跨日不会绕过阻断，基础方案仍可预览。成功读取新 epoch 后清除旧输入和预览；离页重入后的旧恢复回调不解锁新访问。

### Requirement: Shared visual language

系统 SHALL 沿用薄雾绿和暖纸白主题、正文16px/辅助14px、主要按钮48px及触区至少44px；方向与时长有可辨认选中态，非法分钟和空星期有文字错误及定位。

#### Scenario: Invalid or narrow input
- **WHEN** 输入越界分钟、未选星期或在小屏查看预览
- **THEN** 错误靠近字段并可定位，按钮、两档目标及长文本可换行，关键操作不被固定浮层遮挡。
