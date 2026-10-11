# 进度页改版与验证记录

日期：2026-10-11。OpenSpec：`redesign-progress-tabs`。本次在 `dev` 本地实施；开始前已获取 `origin/dev`，本地与远端提交差异为 0/0，保留工作区已有未提交修改。

## 页面行为

- 近7天包含今天及前6天，近1个月固定为最近30天；页面显示准确起止日期。两个统计页展示有打卡天数、累计原目标/忙时次数、截至昨天的按计划打卡率，并将今天单独展示。
- 七天柱图按当天安排比例分档，点日期进入日历；30天趋势连续展示，提供查看日历入口。全部相关习惯直接列出，截至昨天计数与今天状态分开。
- 日历从最早保留习惯创建月浏览到当前月，周一开头，月格显示公历、简化农历和打卡 X/Y。点击当前月未来日期可以只读查看安排，日期跳转限制在最早创建日至今天。
- 翻月保留日号，缺少对应日期时取月末；回到今天同步月份与选择。所选日期下方展示当时已创建的全部保留习惯，包括休息、尚未开始、暂停和归档，直接展示当天目标、档位与已保存备注。
- 所有操作只读。查看习惯进入已有详情；今天仍有待办时提供今日页入口。账户变化清空页面选择，隐藏或过期 picker 回调不再生效；跨午夜更新统计，历史选择保留。
- 未确认或读取失败的数据不生成零统计。已确认数据在现有只读恢复状态下沿用账户内存视图。
- 文字跟随系统字号放大，月份标题在大字号时换行，月格允许增高；忙时柱段与图例使用斜纹以便区分。

## 实现范围

| 文件 | 用途 |
|---|---|
| `miniprogram/pages/progress/index.js/wxml/wxss` | 三个 Tab、趋势、月历、日期导航和完整日记录 |
| `miniprogram/core/progress-review.js` | `summarizeRange`、`buildMonth` 与当天计划版本投影 |
| `miniprogram/core/lunar-date.js`、`lunar-date.LICENSE.txt` | 本地农历转换、传统节日与来源许可 |
| `tests/progress-review.test.cjs` | 统计边界、历史版本、状态与月历投影 |
| `tests/progress-page.test.cjs` | 页面选择、日期跳转、生命周期、读取失败和只读导航 |
| `tests/lunar-date.test.cjs` | 春节、端午、中秋、除夕、闰月、范围和时区 |
| `tests/pages.test.cjs` | 将进度页面旧 28 天预期更新为30天，并遵守最早创建日期边界 |
| `openspec/changes/redesign-progress-tabs/` | 范围、规范、交互和分级验收任务 |

原 `domain.summary` 的7/28天契约与分享保持兼容，本次未新增云接口或运行依赖。农历转换提取自 [solarlunar 3.1.0 固定源码](https://github.com/yize/solarlunar/blob/df2cbf9851ac631fdeeb9ba08325ef8fed97a43d/src/solarLunar.js)，保留 ISC 许可证。支持1900-01-31至2100-12-31，范围外只显示公历；闰月不重复标传统节日，除夕按次日是否春节判断。

## 本地自动验证

| 检查 | 结果 |
|---|---|
| `npm test` | 494/494通过，包含本次48项统计、页面和农历测试 |
| `npm run check` | 364项语法、配置和页面检查通过 |
| `npm run check:cloud` | 52个云文件与源代码一致，无部署或网络请求 |
| `npm run openspec -- validate --all --strict` | 22项通过，0失败 |
| 微信原生编译器 `wcc.exe` / `wcsc.exe` | 各15项输入通过；已编译字节177430 / 45260 |
| 本次文件差异格式 | 通过 |

页面测试使用真实 cloud-session/workspace 接口配合进程内 transport，禁止设备 storage 和写入 dispatch。覆盖7/30天边界、跨年闰年、今天未结束、双档、同名习惯、历史改名和目标修改、暂停恢复、归档删除、无安排、初次失败、待核对、新账户失败、过期 picker 与跨午夜。模拟测试不代表真实账户验收。

## 微信渲染与验收

实际微信开发者工具检查见 [验收报告](audits/2026-10-11-progress-tabs/README.md)、[45张截图](audits/2026-10-11-progress-tabs/gallery.md) 和 [布局与交互断言](audits/2026-10-11-progress-tabs/observations-390.json)。使用独立 tourist AppID 项目与合成账户夹具，自动化端口9442。

- 390px、SDK3.17.3：已取得非空页面栈，双主题 × 字号16/24/32 × 三Tab的实际原生渲染。实际月格宽54px、高80/105.6875/135.59375px，字号增大后单元格自然增高，七列无横滚。
- 大字号证据仅 mock `fontSizeSetting`，当前真实源码据此缩放，原生日期文字实测17/25.5/34px；没有 mock 设备宽度，没有把字号模拟当成真机系统设置验收。
- 历史名称/目标/备注、最早日期、未来只读、翻月、跨年跳转、选择保持、账户重置、跨午夜及各读取状态通过隔离模拟器检查。
- 共13组检查通过，运行时异常0；24个复制文件与当前源码SHA-256一致。cloudCalls、storageCalls、realWrites、requestCalls均为0。
- 320/375px型号切换被 Windows 沙盒初始化错误 `helper_unknown_error: setup refresh had errors` 阻断。Computer Use 重试和重置后仍无法初始化，遵循其恢复规则停止此渠道；尚未取得这两个尺寸的实际截图，不用宽度 mock 替代。

Computer Use 技能入口：`C:/Users/dcd/.codex/plugins/cache/openai-bundled/computer-use/26.1007.21434/skills/computer-use/SKILL.md`。其引用的 `docs/guidance.md` 要求 “Use node_repl JavaScript for all Computer Use actions”，恢复重试后要求 “then stop and report that the Windows Computer Use helper may have failed”。本次阻断发生在 node_repl 初始化阶段。

真机点击热区、系统大字号、真实日期 picker、真实双账户和用户确认仍需对应验收证据。未提交、推送、部署、合并或发布。

## 回滚

按本次实施前的本地版本恢复进度页面三个文件，并仅撤回 `tests/pages.test.cjs` 中本次7/30天和最早日期相关断言；不得用整仓库 reset 或恢复到 HEAD 的方式覆盖用户已有改动。移除本次新增的进度投影、农历源码/许可证及三个测试文件；验收文档与 OpenSpec 可以保留用于追溯。本次未改变账户数据、云端协议或数据库，无数据迁移和账户数据回滚操作。
