# 2026-10-01 UI/交互复核证据

结论与修复规格见[主报告](../../UI-INTERACTION-REVIEW-20261001.md)。截图均为本次会话采集，保存后经图像查看核对；拼图只拼接原截图，未生成或重绘界面。

## 环境与安全边界

- `dev / b3355eb`；本轮已fetch origin/dev，HEAD与origin/dev 0/0。开始时仅 `.claude/`、`qa/` 未跟踪。本轮新增复核文档/证据。
- 微信开发者工具：`E:/weixinDevTool/微信web开发者工具/cli.bat`；automator websocket本机9435。Node automator安装在仓库外 `D:/codex/tmp/jiancheng-design-audit-runtime/node_modules/miniprogram-automator`。
- `systemInfo`：iPhone 12/13 (Pro)，platform devtools，windowWidth390/windowHeight671，SDK3.17.3，version8.0.5，fontSizeSetting16。原截图363×785输出像素，与CSS视口单位不同。
- W真实页面：当前会话已有两任务、两完成、已保存mist。只导航、读取、查看和取消预览，未创建、完成、撤销、保存主题或清理真实数据。
- F：临时替换 `getApp().store/cloudSession/appearanceController/dataReady` 为内存对象；dispatch只选择预先用实际领域reduce生成的合法状态。未知命令直接报错，不代理真实云。结束finally恢复上述对象与今日页，恢复观测 `theme=mist,total=2,done=2`。
- 部分交互使用automator页面处理器调用；没有把这当物理触屏、边缘触区或真实用户易用性验证。路由/点击有工具延迟，使用路径轮询确认；工具超时不当作产品缺陷。
- 第一批F空态/单任务截图出现刷新未完成、残留真实完成页，图像检查后废弃；显式refresh并断言total0/total1且done0后重采10、11。早期异步未完成的撤销/创建截图也重采，最终16/24与数据断言一致。目录中的文件是最终采用版本。
- F23只调用keyboardheightchange(height300)，**没有实际软键盘**；不能证明输入不被键盘遮挡。
- 没有进行D真机、C真实写入/双账户、U真实用户任务，未运行build、部署、提交、push或merge。

## 截图与对应状态

| 文件（均为png） | 等级 | 最终核对的页面/状态 |
| --- | --- | --- |
| 01-today-LIVE | W | 当前真实今日2/2，完成分组折叠、次日安排 |
| 02-create-LIVE / 03-create-bottom-LIVE | W | 从读书模板进入确认，30/10、每天/今天、更多设置、底部创建按钮；未提交 |
| 04-progress-LIVE | W | 真实7日进度，4次完成/4次安排，今日条目 |
| 05-mine-LIVE | W | 分组、短句开关、外观入口；未修改设置 |
| 06-appearance-LIVE | W | 已保存薄雾绿，标签使用中 |
| 07-appearance-preview-LIVE / 08-appearance-bottom-LIVE | W | 暖纸白本页预览、下滑后保存按钮；返回取消，未保存 |
| 10-first-entry-F-mist | F | 薄雾绿空态，四模板+自定义，total0 |
| 11-one-task-F-mist | F | 单任务5/2待做，两个记录按钮+仅调小动作，total1/done0 |
| 12-three-tasks-F-mist | F | 三待做，done0 |
| 13-recording-F-mist | F | 人工保持第一项忙时dispatch未返回，当前项正在记录 |
| 14-busy-completed-F-mist / 15-busy-completed-bottom-F-mist | F | 确认后done1、pending2、分组展开；顶部与下滑后的目标/撤销 |
| 16-undo-F-mist | F | 撤销确认后done0、pending3，今天2/原计划5保持 |
| 17-five-long-tasks-F-paper / 18-five-long-bottom-F-paper | F | 暖纸白五任务，合法20码点长名称、滚动底部 |
| 19-mine-F-paper | F | 暖纸白我的，5项 |
| 20-first-entry-F-paper | F | 暖纸白空态，30/10等当前模板 |
| 21-create-F-paper | F | 暖纸白确认30/10 |
| 22-form-error-F-paper | F | 忙时输入30=平时30，具体错误文字，正常框边界 |
| 23-keyboard-layout-F-paper | F | 注入键盘高度事件后的布局，非真实键盘 |
| 24-created-guide-F-paper | F | mock创建确认后真实页面回今日，0/1，新任务引导 |
| 25-theme-preview-F / 26-theme-applied-F | F | 从保存paper预览mist，mock保存后标签/全局更新，非真实持久化 |
| 27-progress-error-F / 28-progress-recovered-F | F | mock读失败，实际重试处理器调用后恢复 |
| 29-today-offline-F | F | 受控本会话已有内容、更新失败文字、写按钮禁用 |
| 30-theme-preview-before-read-LIVE / 31-theme-preview-after-read-LIVE | W | 从已保存mist选paper后，实际ensureRead(true)；未保存，根theme回mist而preview仍paper |
| 32-other-actions-during-record-F | F | 第一项未返回，其余按钮仍正常显示；第二项处理器没有新增dispatch |
| 33-undo-inflight-F | F | 撤销未返回，完成事实保留但撤销按钮无等待反馈 |

`contact-01`至`contact-06`为核对拼图；`journey-reviewed`按空态→确认→记录→完成→进度→主题排列，混合W/F，来源见上表；`theme-refresh-comparison`来自W30/31。

## 结构化记录与复现

- `fixture-observations.json`：最终忙时完成、撤销、两按钮尺寸、错误字段、mock创建/主题意图。随机habit ID是内存合成值，无真实账户标识。
- `inflight-observations.json`：写锁时第二项调用前后dispatch数均1；撤销中recordingId存在、完成事实仍1。
- `theme-refresh-live.json`：真实读取前/后根theme、preview、savedTheme、按钮文案。
- `code-behavior-probes.json`：实际主题客户端/协调器/Page生命周期，模拟传输，无网络。R2旧frozen和R1两订阅覆盖均复现；附带离线待核对按钮状态观察不作为本轮主要缺陷结论。
- `contrast-check.json`：当前token的18组组合计算全部达标，不包括全页面/全状态审计。
- `npm-test.log`：本轮完整测试输出，327/0/0。其他命令的计数来自本轮工具标准输出，未复制旧日志冒充新执行；主报告列出309结构检查、61副本一致、15规范通过。

本地主题复现（无需开发者工具，不会网络请求）：

```powershell
node docs/audits/2026-10-01-ui-interaction-review/reproduce-theme-issues.cjs
```

脚本输出实际观测并更新本目录JSON，**不是“测试全部通过”断言**。修复AI应将对应期望写入业务回归测试。

W主题复现：打开外观→保持已保存mist→选paper→调用当前实际控制器ensureRead(true)，核对root theme/preview/savedTheme及截屏→返回今日。正常用户首次延迟读取/失败后重读走同一通知路径；本轮明确触发重读验证覆盖。

F写锁复现：用实际领域命令构造3待做及完成/撤销结果，替换store为不调用真实云的内存dispatch→人工延迟第一项busy完成→滚动第二项，核对正常按钮外观→触发第二项处理器，记录dispatch数→释放第一回执→人工延迟undo，核对完成行等待反馈→释放、恢复原对象。勿在真实store上用完成命令制造数据。

复核后保持原有真实会话。后续真实保存、双账户、清理、部署和真机需分别安排，不继承本目录F/L通过结论。
