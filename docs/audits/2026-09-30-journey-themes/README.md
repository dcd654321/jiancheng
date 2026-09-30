# 2026-09-30 旅程优化与双主题 · 证据索引

对应变更：`openspec/changes/refine-journey-and-add-themes`。执行规格：`docs/AI-OPTIMIZATION-HANDOFF-20260930.md`；
验收清单：`docs/AI-OPTIMIZATION-ACCEPTANCE-20260930.md`；逐项结论见 [ACCEPTANCE-RESULTS.md](ACCEPTANCE-RESULTS.md)。

## 环境

- 实施基线：dev 分支（HEAD 3f211d7 + 本轮未提交修改；实施前已确认工作区仅有 `?? .claude/`）。
- 微信开发者工具：基础库 3.17.3，模拟器视口 390×844，未安装真机/双账户环境。
- 自动化命令：`npm test`（332 通过 / 0 失败 / 0 跳过，含实际执行而非跳过的 SDK 合同测试）、
  `npm run check`（316 项）、`npm run check:cloud`（61 个云副本一致）、
  `npm run openspec -- validate --all --strict`（14 通过 / 0 失败）。

## 证据分级

- **W**：微信开发者工具真实渲染 + 真实云会话（开发者账户，测试环境）。文件名含 `-W-real`。
- **F**：真实模板/事件/渲染管线 + 注入内存状态（替换 `getApp().store` / `appearanceController`，
  不写云端）。文件名含 `-inject`。F 不能证明云写入成功。
- **L**：`npm test` 自动测试（本目录不保存日志，命令与计数见上）。

## 截图清单（均为 390×844）

| 文件 | 级别 | 说明 |
| --- | --- | --- |
| `A27-today-empty-mist-W-real` | W | 真实空账户首次进入：价值标题、4 模板（平时/忙时双档）、自己设一个、帮我定个起点 |
| `A11-edit-compact-mist-W-real` | W | 模板进入的紧凑确认页（读一会儿 5/2、每天、今天开始、固定底栏） |
| `A27-appearance-closed-mist-W-real` | W | 能力关闭时直接进入外观页的中性说明与返回 |
| `A27-mine-entry-hidden-mist-W-real` | W | 能力关闭时“我的”隐藏外观主题入口 |
| `A01-progress-loading-mist-inject` | F | 首次读取中的中性占位（不显示空账户结论） |
| `A02-progress-unavailable-mist-inject` | F | 读取失败的可见“重新读取”入口（含具体原因） |
| `A02-progress-recovered-mist-inject` | F | 按钮触发真实恢复后原地呈现内容（同一页面、无跳转） |
| `A18-today-pending-mist-inject` | F | 单任务：平时 5 分钟 + 忙时 2 分钟标签 + 按 N 记下动作 |
| `A18-today-completed-inplace-mist-inject` | F | 点击后原位完成行“已按原目标完成 · 5分钟”+ 撤销这次记录 + Toast |
| `A22-today-two-retained-mist-inject` | F | 一次访问内两次完成，两行均原位保留，2/2 与忙时计数正确 |
| `A22-completed-group-mist-inject` | F | 展开“今日已完成（1）”，原位行不重复出现 |
| `A20-today-simplified-mist-inject` | F | 今日目标已调小：按今天 2 分钟记下 + 原计划说明 + 恢复今天原目标 |
| `A44-today-return-line-mist-inject` | F | 回归只留一句“回来就从今天的一点开始。”紧邻任务行，不复制按钮 |
| `A43-today-chooser-mist-inject` | F | 已有任务时“添加习惯”内的选择区（模板 + 自己设一个 + 帮我定个起点） |
| `A46-progress-seven-days-mist-inject` | F | 进度：事实计数 + 条件建议文案；分母为真实安排 |
| `A28-today-pending-paper-inject` | F | 暖纸白今日页（页面作用域 + 原生导航/Tab 官方 API 换色） |
| `A28-today-completed-inplace-paper-inject` | F | 暖纸白原位完成行 |
| `A28-today-simplified-paper-inject` | F | 暖纸白已调小状态 |
| `A28-edit-compact-paper-inject` | F | 暖纸白紧凑确认页 |
| `A46-progress-seven-days-paper-inject` | F | 暖纸白进度页与建议 |
| `A28-mine-theme-entry-paper-inject` | F | 暖纸白“我的”与“外观主题：暖纸白”入口 |
| `A28-appearance-using-paper-inject` | F | 主题页：暖纸白“使用中”，缩略图固定各自主题 |
| `A28-appearance-preview-mist-paper-inject` | F | 选中薄雾绿仅本页预览（“预览中”“使用薄雾绿”），不发写请求 |
| `A28-appearance-after-save-paper-inject` | F | 保存回执后全局切换 + “已切换为薄雾绿”提示 + “正在使用” |
| `A27-mine-entry-visible-client-on-server-off` | W | 客户端开关已开、云端未启用：“我的”出现外观主题入口（真实云会话） |
| `A27-appearance-client-on-server-off` | W | 同上前提下外观页的降级：可预览、保存禁用并说明“主题暂未读取”（真实云读取被拒） |

## 逐像素颜色核对（真实渲染，详见 png-tool 采样）

| 采样点 | 期望 token | 实测 |
| --- | --- | --- |
| 薄雾绿今日页页面底 | #F7F8F5 | `#F7F8F5` |
| 暖纸白今日页页面底 | #FAF8F3 | `#FAF8F3` |
| 薄雾绿主按钮（创建这个习惯） | #486557 | `#486557` |

## 决策记录（2026-09-30）

- 主题色值维持执行规格原值：用户查看"加强对比"候选预览（`cand2-strong-*` 四张，仅为工具内临时
  渲染的讨论材料，**未采用、未进代码**）后决定"先不动"。工作区 token 已核对为规格值。
- 主题读取/保存在共享测试环境真实可用（云端回执 `revision:0, theme:'mist'`；用户已完成两次真实保存，
  `revision=2`）；真机、双账户与用户测试待后续安排。
- 2026-09-30 22:00 排查"切换薄雾绿却提示暖纸白"：根因为**验证脚本注入残留**（对比截图脚本在共享的
  工具实例中替换了假主题控制器且未恢复，假控制器对任何请求都返回暖纸白且不写云端），非应用缺陷。
  已修复脚本（采集结束自动恢复）并用真实链路复测：切暖纸白 → “已切换为暖纸白”；切回薄雾绿 →
  “已切换为薄雾绿”（证据 `A29-after-switch-mist-live`，Toast 文案以拦截记录为准）。
- 2026-09-30 22:15 排查“按钮反应慢”：应用逻辑层 eval 往返 11ms；应用内 `wx.reLaunch` 实测 1987ms、
  真实点击“外观主题”进入页面 1787ms（所有页面一致）。判定为开发者工具长时间运行后的渲染/编译
  退化（两个工具进程累计数千秒 CPU + 机器其他重负载），非业务代码问题；已建议完全重启工具。
  重启后的新实例中真实点击复测通过：外观页 `savedTheme:'mist', hasRevision:true, 正在使用`。
- 2026-09-30 22:30 云端读取耗时实测（开发工具、热函数）：一次 `pull` 往返 **720/535/550ms**；
  对比：应用内页面切换 1987ms 且不触发云请求（页面渲染内存快照），逻辑层 11ms。结论：冷启动
  “正在读取云端记录”的等待 ≈ 一次云读取（~0.5–0.7s，手机冷启动可能 1–3s）；页面切换慢主要是
  工具侧渲染退化，与云请求无关。

- 2026-09-30 22:40 按用户要求把冷启动等待改为友好小页面（纯展示改动，无行为/数据变化）：
  `today` 加载态 = 按时段问候（早上好/中午好/下午好/晚上好/夜深了）+ 一句轻松说明（按日期轮换的
  内置文案）+ 主题色三根"生长"小柱动画 + 如实说明"正在读取云端记录，需要一点时间"，下方保留
  占位卡避免加载后跳变。随包静态文案，不读取账户数据；多主题下颜色自动跟随（薄雾绿/暖纸白）。
  证据 `A01-today-loading-friendly-mist-inject-w390`（注入读取中状态的真实渲染）。

## 未采集 / 阻塞

- 320×430 宽度、设备大字号、软键盘、安全区与读屏：模拟器设备切换与真机项，未采集（见 ACCEPTANCE-RESULTS 的分层结论）。
- 分享/提醒/AI/云端主题保存的真实云端链路：能力开关未开启、无云端授权，保持关闭，不在本轮证据内。
- 真实用户测试（U01–U07）：未开展。
