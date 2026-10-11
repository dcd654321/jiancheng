# 进度三 Tab 原生模拟器验证

日期：2026-10-11。结果：PASS，13 组检查，45 张原生截图。

## 工程与输入

独立 touristappid 工程：`qa/local/progress-tabs-20261011/project`，自动化端口 9442。直接复制当前 progress JS/WXML/WXSS、领域投影、农历及 UI 服务，不重写页面渲染或交互处理器。完整源文件 SHA-256 见 [fixture-source.json](fixture-source.json)。

固定北京时间 2026-10-11，使用内存合成习惯：历史改名和目标变更、同名、长标题、工作日习惯、暂停、归档、明天开始，及两档打卡和已保存备注。App 启动即阻断 wx.cloud、设备存储、网络和 store.dispatch。生产账户数据未被读取。

## 实际渲染矩阵

微信开发者工具基础库 3.17.3，实际 windowWidth 为 390px，iPhone 12/13 (Pro) 390×844。两个主题均完成近7天、近1个月、日历及完整习惯/日记录截图。每格有效宽度54px，七列月历宽378px。

| 主题 | fontSizeSetting | 页面缩放 | 原生日数字号 | 月格宽度 | 最小月格高度 |
| --- | --- | --- | --- | --- | --- |
| 薄雾绿 | 16 | 1 | 17px | 54px | 80px |
| 薄雾绿 | 24 | 1.5 | 25.5px | 54px | 105.6875px |
| 薄雾绿 | 32 | 2 | 34px | 54px | 135.59375px |
| 暖纸白 | 16 | 1 | 17px | 54px | 80px |
| 暖纸白 | 24 | 1.5 | 25.5px | 54px | 105.6875px |
| 暖纸白 | 32 | 2 | 34px | 54px | 135.59375px |

字号16/24/32通过 automator 仅 mock getSystemInfoSync 的 fontSizeSetting 字段；宽度没有 mock。当前业务页面源码读该值并通过 CSS 变量缩放原生文字，已读原生 style 和 boundingClientRect 确认。月格随字号增高，七列无横滚；全列表直显，长标题和多行备注可滚动查看。此项为模拟器原生样式验收，设备系统设置及真机字号未验收。

## 交互与读取状态

- 原生 tap 验证三个 Tab、七天日期进入日历、月翻页、回今天、未来日期、今日入口和查看习惯路由。
- 日期 picker 的打开 guard 与 change 事件经 automator 驱动：2026-01-31翻至2026-02-28，跨年跳到最早2025-12-20；超出今天的日期跳转拒绝。原生滚轮手势和真机 picker 未验收。
- 2026-10-07保留旧名称“读一会儿”、原目标30分钟及多行备注；未来不计未打卡，今天列表含全部7个已创建保留习惯。
- 验证 Tab 选择记忆、过期 picker 回调拒绝、账户上下文变化重置、跨午夜今日跟随及历史选择保留。
- 空账户、加载、读取失败、待核对、已确认内存数据只读五种夹具状态分别原生截图；未知数据不生成零统计。

运行时 pageStack：pages/progress/index, pages/detail/index。cloudCalls=0、storageCalls=0、realWrites=0、requestCalls=0，运行时异常0。详细断言和布局指标见 [observations-390.json](observations-390.json)，截图见 [gallery.md](gallery.md)。

## 编译与待验项

已安装微信 wcc.exe 15个输入、wcsc.exe 15个输入通过。编译只确认原生语法，不替代上面的实际渲染。业务自动测试、常规check、云副本一致性和OpenSpec校验由根实施记录分别报告。

320/375px实际原生尺寸未完成。用于切换隔离窗口尺寸的 Computer Use node_repl 初始化发生 Windows sandbox helper_unknown_error: setup refresh had errors，reset后仍失败，按技能恢复要求停止该渠道；没有以mock系统宽度冒充布局。

真机触摸/滚轮/字体、真实双账户云读取及用户验收仍需对应证据。未提交推送、部署或发布；本次仅本地实现和验证。

## 复现

本地准备命令：`node qa/local/progress-tabs-20261011/prepare.cjs`。CLI 只打开隔离工程：`cli.bat auto --project <隔离project绝对路径> --auto-port 9442`。就绪后运行 `node qa/local/progress-tabs-20261011/verify.cjs`；验证会读取实际窗口宽度并在截图名中使用它。

脚本和锁定 automator 0.12.1 依赖仅在 .gitignore 忽略的 qa/local 内。外部用户项目与现有开发者工具会话不在脚本操作范围。
