# 实施与验收结果（2026-09-30 · 本地实施轮）

对应变更：`refine-journey-and-add-themes`。版本口径：dev 分支本轮工作区（未提交、未部署、未合并）。
证据目录：[README.md](README.md)。结论只使用 PASS / FAIL / BLOCKED / NOT_RUN；SKIP 计入 BLOCKED。

## 0. 分层数据（互不替代）

| 层 | 本轮结果 |
| --- | --- |
| L 自动测试 | `npm test`：332 通过 / 0 失败 / 0 跳过（`tests/features-sdk.test.cjs` 实际执行，锁定依赖已安装，非跳过） |
| W 微信开发者工具 | 真实渲染 + 真实云会话截图 4 张；注入状态渲染 20 张（F）。未开展面向全部 13 页 × 全状态 × 多宽度的遍历 |
| D 真机 | NOT_RUN（无设备；大字号、读屏、键盘、安全区未验证） |
| C 真实云端/双账户 | BLOCKED（未授权：不部署、不写远端测试数据、不改共享配置；云端主题动作保持关闭） |
| U 目标用户测试 | NOT_RUN |

规范校验：`npm run openspec -- validate --all --strict` 14 通过 / 0 失败。
云副本：`npm run build:cloud` 61 文件；`npm run check:cloud` 与源一致（未部署）。

## 1. 实施映射（需求 ID → 主要文件）

| ID | 实现 | 主要文件 |
| --- | --- | --- |
| UX-01 | 共享读取恢复：`ui.read` 三态（读取中/不可用/只读回退）+ `recoveryActions.onDataRetry`（单飞、防连点、原地恢复、重新核对文案）；today/progress/manage/detail/edit/data/mine 均接入；“写入结果不明”用会话冻结请求复用同一 operationId | `miniprogram/services/ui.js`、`services/cloud-session.js`（`staleRead`、`status.stale`）、`services/workspace-store.js`（`stale()`）、各 `pages/*/index.wxml` 的 dataUnavailable 块 |
| UX-02 / TH-01 | 语义 token 单源（mist/paper），生成 `styles/theme.wxss`；`app.wxss` 全量改 `var()`；正文 16 / 辅助 14 / 按钮 48 / 触区 44；卡片改纯色 + 细线；两主题共用一套 WXML | `config/theme-tokens.js`、`scripts/build-themes.cjs`、`styles/theme.wxss`、`app.wxss`、`app.json`（导航/Tab 配色与图标） |
| UX-03 | edit 页紧凑确认（模板/有效草稿）与完整表单（自定义/编辑）双形态；频率/开始日摘要可展开；固定提交底栏 + `bindkeyboardheightchange` 键盘流式布局；容量满时明确“明天开始”；错误就近定位首错 | `pages/edit/index.js`、`index.wxml`、`index.wxss`、`services/plan-form.js`、`services/today-flow.js`（`creationAvailability`） |
| UX-04 | 记录动作写明数量与单位：“按 5 分钟 记下”“忙时按 2 分钟 记下”；已调小状态“按今天 2 分钟 记下”+“恢复今天原目标”，不出现同义忙时按钮；“做完再记下，不会自动计时。”仅一次 | `templates/task.wxml`、`app.wxss`、`services/ui.js`（`recordCompletion` 串行锁与文案） |
| UX-05 | 本次可见访问多条完成原位保留（上限 5、按习惯 ID+日期去重、跨天/换账户/隐藏即清）；原位行不重复进“今日已完成（N）”；撤销文案“已撤销这次记录”，忙时撤销保持今日 2 分钟 | `pages/today/index.js`、`index.wxml`、`services/today-flow.js`（`retainCompletion`/`effectiveRetained`/`pendingRows`）、`services/ui.js`（undo Toast） |
| UX-06 | 助手预览收敛为名称/两档/天数/一句理由；详细说明折叠“为什么这样建议”；采用仍进紧凑确认；空态保留文字入口、已有任务时入口收进“添加习惯”选择区 | `pages/assistant/index.js`、`index.wxml`、`pages/today/index.js`、`index.wxml` |
| UX-07 | 进度建议先事实后条件：`这段时间安排 N 次、记录 M 次。…`；三种条件建议，应做日不足 3 天不下判断 | `core/progress-advice.js`、`pages/progress/index.wxml` |
| UX-08 | 分享落地：有效计划“这是一份可参考的习惯计划”“按这个计划试试”；失效给原因 +“去今日”；详情无效 ID 给原因与出口；历史/长列表沿用既有滚动 | `pages/share-view/index.*`、`pages/detail/index.js`、`index.wxml` |
| TH-02 客户端 | `config/appearance.js`（默认 false）、`services/appearance-client.js`（严格回执校验、读取去重、冻结同请求重放、冲突读取不覆盖）、`services/appearance.js`（状态/订阅/原生换色）、外观页（两张固定预览、使用中/预览中、保存/冲突/离线/待核对）、我的入口与待核对提示、`app-lifecycle` 并行读取不阻塞核心 | 上述文件 + `pages/appearance/*`、`pages/mine/index.*`、`services/app-lifecycle.js`、`app.js` |
| TH-02 云端 | `server/features.js`：`getAppearance`/`setAppearance` 白名单、`theme` 可选字段（缺省 mist、非法 PREFERENCES_CORRUPT）、共享 revision/幂等收据、最小投影；`server/entries/features.js`：共同安全条件 + 独立 `HABIT_APPEARANCE_ENABLED`（不连带 features/分享/提醒） | `server/features.js`、`server/entries/features.js`、生成副本（`npm run build:cloud`，未部署） |

保留约束核对：活跃上限 5（`core/habits.js` 未改）；双档目标与次日生效规则未改；云端唯一持久来源，
无新增本机快照/离线队列、无账户绑定持久化（`npm run check` 的扫描强制）；身份仅来自受信上下文；
主题独立开关默认关闭，未连带开放分享/提醒/AI。

## 2. A01–A50 结论

| 编号 | 层级与证据 | 结论 |
| --- | --- | --- |
| A01 | L：startup-pages 延迟启动/隐藏页不更新；F：`A01-progress-loading` 中性占位。W 真机级未测 | PASS（L/F） |
| A02 | L：`reliability`/`ux` 恢复入口与单飞；W/F：`A02` 三张（失败 → 重新读取 → 原地恢复） | PASS（L+W/F） |
| A03 | L：`reliability` 只读回退保留内容、动作给原因、断网不写云 | PASS（L）；W/D 未测 |
| A04 | L：`cloud-session` 丢回执冻结同 operationId 重放、仅 1 次写入 | PASS（L），W 未测 |
| A05 | L：startup-pages 旧回执不更新、账户切换旧回执丢弃 | PASS（L），W 未测 |
| A06 | L：容量/校验/冲突/身份失效分项测试；`network-recovery` 有界单次 | PASS（L），W 未测 |
| A07 | L：theme.test 断言字号/触区下限、对比度；W/F：390 宽双主题 10+ 张。320/430 与大字号未测 | 部分 PASS；320/430 → BLOCKED（设备切换/真机） |
| A08 | L：theme.test 计算全部文档组合对比度（文字 ≥4.5、控件边界 ≥3）；W：像素采样精确命中 token | PASS（L），按下/焦点态逐项未截图 |
| A09 | L：旧浓色（#245c44/#ddf3a4）从活动样式移除断言；记录按钮与详情入口为并列而非嵌套 | PASS（L）；W 视觉 PASS |
| A10 | 读屏/焦点顺序/胶囊与键盘遮挡 | BLOCKED（真机） |
| A11 | L：ux 模板确认默认值/未提交不创建；W：390 截图同时可见两档/频率/开始日/创建按钮；360 未测 | PASS（L+W390）；360 → BLOCKED |
| A12 | L：ux 分支形态 + 草稿一次性 + 分享草稿 edit 流程；W 未采 | PASS（L） |
| A13 | L：字段校验与领域一致、首错定位、摘要同步 | PASS（L） |
| A14 | L：边界（1/120/121/999/1000、忙时空值、等值拒绝） | PASS（L） |
| A15 | L：满容量走管理、明天摘要与 `capacityNote`、竞争由领域拒绝保留输入 | PASS（L） |
| A16 | L：保存锁、失败留页、丢失回执不导航；键盘/真机 | PASS（L）；键盘与遮挡 → BLOCKED |
| A17 | L：编辑次日生效、版本冲突不覆盖 | PASS（L） |
| A18 | L：串行锁、确认后 standard/计数；F：`A18` 两张 | PASS（L+F） |
| A19 | L：quickMinimum 开/关两路径、最小记录语义；F：忙时完成原位行 | PASS（L+F） |
| A20 | L：已调小状态动作与恢复；F：`A20` + 暖纸白版 | PASS（L+F） |
| A21 | L：重复点击单意图（新增用例）、已知/未知/畸形回执 | PASS（L） |
| A22 | L：多完成保留、去重、上限 5、分组去重；F：两张 | PASS（L+F） |
| A23 | L：undo 保持目标 2、原计划 5、随手记保留、Toast 文案（新增用例） | PASS（L） |
| A24 | L：撤销走同一冻结/重放通道（会话级）；失败保留入口 | PASS（L，部分）；W 未测 |
| A25 | L：隐藏/跨天/换账户清除保留行且不回放 | PASS（L） |
| A26 | L：全完成计数、展开已完成撤销、无强制弹窗 | PASS（L） |
| A27 | L：缺 theme 读取不落库、能力关闭隐藏入口；W：`A27` 三张 | PASS（L+W） |
| A28 | L：appearance-pages 预览不写/返回丢弃/标签；F：`A28` 主题页三张 + 暖纸白全页 | PASS（L+F） |
| A29 | L：保存一次请求、回执后应用、已用主题不重复提交；F：保存后截图 | PASS（L+F） |
| A30 | L：全部注册页根节点消费主题、旧色清除、官方 API 换色；W/F：今日/创建/进度/我的/外观两主题 | 部分 PASS；其余页面与弹层未逐一截图 → W 部分 |
| A31 | L：身份隔离、A/B 账户互不影响；C 未授权 | PASS（L）；C → BLOCKED |
| A32 | L：非法 theme/版本/字段/操作 ID 拒绝、损坏 PREFERENCES_CORRUPT、投影最小 | PASS（L） |
| A33 | L：同请求重放不增版本、不同指纹拒绝、返回当前值 | PASS（L） |
| A34 | L：冻结同请求、只重放、确认后应用 | PASS（L） |
| A35 | L：冲突不覆盖、读取当前、再次确认才新写 | PASS（L） |
| A36 | L：旧账户回执丢弃、控制器按 contextKey 重置 | PASS（L） |
| A37 | L：离线/pending/无 revision 拒绝保存；无本机持久（check 扫描） | PASS（L） |
| A38 | L：离页不取消已发事务、未知待核对、卸载页不回调 | PASS（L） |
| A39 | L：开关矩阵（仅主题启用时可用、共同条件缺失即拒绝、0 数据库访问） | PASS（L） |
| A40 | L：两写入口互不丢字段、共享 revision/收据、限流沿用；C 未授权 | PASS（L）；C → BLOCKED |
| A41 | L：清理按 ownerEpoch 清除偏好；真实清理未执行 | PASS（L，部分）；C → BLOCKED |
| A42 | L：未启用/不支持可解释、不阻塞核心；部署与回滚未执行 | PASS（L，部分）；部署项 → BLOCKED |
| A43 | L：助手入口/预览/采用两步；F：选择区截图 | PASS（L+F） |
| A44 | L：回归规则不变、单句提示、同步异常优先；F：提示行截图 | PASS（L+F） |
| A45 | L：首次引导一次、无强制弹窗；真实创建后的引导 W 未采 | PASS（L）；W 未测 |
| A46 | L：统计与文案分支；F：两主题进度截图 | PASS（L+F） |
| A47 | L：分享页文案与出口、既有分享测试；C/W 未开放 | PASS（L）；C → BLOCKED |
| A48 | L：无效详情出口（新增用例）、管理页历史列表；F6 长内容未专门采集 | 部分 PASS |
| A49 | 已采集 390 宽 × 两主题 × 10+ 状态；320 长字/键盘/弱网/安全区未采集 | 部分；其余 → BLOCKED |
| A50 | 全套命令本轮通过；真机/双账户未测；无云配置变化、未部署、未提交 | 部分 PASS；D/C/U 单列未完成 |

## 2.5 复核修正（本轮交付后逐项核对时发现并修复）

逐项复核规格时发现并修正四处偏差，随后全量重跑（332 通过 / 0 失败 / 0 跳过）：

1. **记录进行中状态**（规格 4.3）：新增 `recordingId` —— 写入未确认时对应行的按钮显示
   “正在记录…/正在撤销…”并禁用；串行锁与页面其余内容不变；L 用例覆盖。
2. **表单焦点轮廓**（组件规范）：`edit`/`detail`/`assistant` 输入聚焦时显示 2px 主题主色
   内侧轮廓（不改变布局），错误态仍为 2px error 边框 + 文字说明。
3. **功能页恢复入口对齐**：`reminder`/`share-create`/`share-list` 的读取失败状态补上与私有页
   相同的“重新读取”按钮与 `recoveryLabel`（复用同一单飞恢复器）。
4. **文案与配色对齐**：读取失败标题统一为规格原句“暂时没能读取记录”；清除最后的硬编码旧绿
   （`assistant` 复选框、`share-create` 开关、`detail` 与“少做一点”弹窗按钮色改用当前主题
   主色 `ui.primaryColor()`）。A02 恢复流程截图已按新文案重拍。

## 3. 未完成与阻塞（保持开关关闭）

1. 云端外观协议部署与真实云/双账户验收（A31/A33/A40–A42 的 C 层）：未授权部署；
   `HABIT_APPEARANCE_ENABLED` 未在云端设置。**客户端 `config/appearance.js` 已按用户指示
   （2026-09-30）改为 `enabled:true`**；客户端开、云端未启用的过渡状态已在开发者工具验证：
   “我的”出现入口，外观页可预览、保存禁用并说明“主题暂未读取”，无假成功
   （截图 `A27-mine-entry-visible-client-on-server-off`、`A27-appearance-client-on-server-off`）。
   2026-09-30 晚受控连通验证（含两次修正）：
   1) 首次验证发现客户端 `appearance-client` 把请求发到了主函数 `jiancheng_daka_api`（而非
      `jiancheng_daka_features`），已修复并补回归测试（断言传输器 functionName）；
   2) 修复后请求到达正确函数，但运行实例报 `Cannot find module './lib/features'`——云端
      下载比对显示 $LATEST 代码与本地逐字节一致，即代码已上传、函数实例未更新
      （证据 `A29-connectivity-check-server-old-version`）；
   3) 用户重新上传后实例更新成功，运行返回按设计给出 `NOT_ENABLED 服务尚未开放`——指向
      共同门禁环境变量尚未配置（该共享测试环境此前从未启用过该函数）。待配置后复测。
   4) 按用户要求（2026-09-30）：把可安全内置的部署项全部改为代码默认值——限流数字默认
      `{60, 2000, 30, 300}`（`server/limits.js` 支持默认值，非法显式值仍拒绝）；features 入口的
      共同前提（身份/清理/限流/来源）与主题开关默认视为就绪，`HABIT_APP_ID` 缺省绑定本应用
      AppID；显式设 `'false'` 可恢复“未确认即停服”的严格行为。**分享/提醒/AI 的总开关保持必填
      且默认关闭，默认放开的仅是主题动作**。真实鉴权（受信平台上下文、AppID 匹配、来源白名单、
      限流、账户/epoch/清理检查）全部在代码层无条件执行，未因默认值而放宽。
      偏差记录：原握手规格 7.1 要求“所有开关缺失默认关闭”，现按用户指示对 features 入口的
      部署期开关改为默认开启（保留 false 回退）；L 用例覆盖 `tests/features-entry.test.cjs`、
      `tests/limits.test.cjs`。云副本已重建；**启用不再需要任何环境变量**。
   5) 用户完成部署后**真实云复测通过**：`getAppearance` 返回 `{ok:true, appearance:{revision:0,
      theme:'mist'}}`；控制器 `loadState:'ready'`；“我的”显示“外观主题 · 薄雾绿”；外观页两张卡
      正常（使用中/预览中），选择暖纸白进入预览态、按钮“使用暖纸白”可用
      （截图 `A29-mine-theme-entry-live`、`A29-appearance-live`、`A29-appearance-preview-paper-live`）。
      待办：真实保存往返（写一次偏好并读回）与双账户隔离（A31/A33/A40–A42 的 C 层）仍待用户
      测试或后续授权；主题读/存协议本身已在测试环境真实可用。
2. 真机项（A07/A10/A16/A30/A49–A50 的 D 层）：无设备。
3. 320/430 宽度与大字号：开发者工具模拟器设备切换未自动化。
4. 分享/提醒/AI 的真实链路：能力保持关闭，仅做受控协议与文案验证。
5. 真实用户测试 U01–U07：未开展。

## 4. 已知风险与回滚

- 未部署：本轮改动不影响线上；回滚方式是把工作区恢复到 3f211d7（或丢弃本轮修改）。
- 若后续部署云端：回滚先关闭 `HABIT_APPEARANCE_ENABLED` 与客户端 `config/appearance.js`，
  再回退函数；旧文档缺 `theme` 读取为 mist，不需要数据迁移，也不批量删除偏好。
- 共享偏好 revision 跨设备冲突：界面提供冲突说明并要求用户再次确认，不自动覆盖。
- 主题为账户级偏好：换账户/清理后回到默认薄雾绿，不落本机缓存（断网只能预览，不能保存）。
