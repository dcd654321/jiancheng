# Tasks

## 1. Implementation

- [x] 1.1 空状态与首次进入：价值标题、四个双档模板卡、"自己填写"、助手辅助行；无习惯隐藏页头按钮。验证：页面测试断言 hasHabits 前后差异与模板参数透传（core-experience 结构断言、ux 模板参数用例）。
- [x] 1.2 今日任务卡重构：两行结构、打卡胶囊、忙时软按钮、完成标记与撤销；`templates/task.wxml` 与 `app.wxss` 同步。验证：页面控制器测试与 WXML 结构断言（ux 三段式断言）。
- [x] 1.3 回归卡动作改为直接记录（原目标／忙时／退回输入），移除跳转详情；今天已有任一记录后不再显示回归卡。验证：回归页测试四种动作与失败不写。
- [x] 1.4 完成反馈文案：`已保存到云端` 全量替换为"记下了 · 已同步"系列，保持云端确认时机。验证：workspace／pages／回归测试的 toast 断言与旧词扫描。
- [x] 1.5 进度页：短日期区间、空状态收敛、指标重排、脚注；新增 `core/progress-advice.js` 与测试（五种输入分支）。验证：core-experience 建议单测与进度页集成用例。
- [x] 1.6 术语与状态文案：忙时完成／忙时目标（含 `core/habits.js` 读屏描述）、云端状态命名、编辑页标题、失败文案"读不到"、今日加载骨架。验证：术语扫描测试与页面测试。
- [x] 1.7 全局视觉 token 与完成动画：`app.wxss` 颜色、卡片、字号层级、骨架样式、印章动画。验证：结构检查与原生编译通过；渲染截图复查待办（2.7）。
- [x] 1.8 启用 `completeMinimumEnabled`（test 与 product 目标）；保留旧云分支与对应测试。验证：配置测试通过；云端回执核验单独列 2.6，尚未执行。
- [x] 1.9 测试更新与新增：ux／pages／回归页／workspace 既有断言更新；新增 `tests/core-experience.test.cjs`（日期短格式、建议分支、进度集成、空状态结构、开关、命名、旧词扫描）。

## 2. Verification

- [x] 2.1 `npm test`：286 项全部通过（2026-09-30）。
- [x] 2.2 `npm run check`：295 项结构与页面检查通过。
- [x] 2.3 `npm run check:cloud`：61 个云包文件与源码一致。
- [x] 2.4 `npm run openspec -- validate --all --strict`：13 项通过。
- [x] 2.5 原生 WXML/WXSS 编译：15 个 WXML 输入与全部 WXSS 通过（wcc/wcsc）。
- [ ] 2.6 共享测试环境部署后的 `completeMinimum` 真实回执核验（需部署授权，单独安排）。
- [ ] 2.7 模拟器点击与截图复查（创建、打卡、撤销、忙时、回归、进度），记录是否发生业务写入。
- [ ] 2.8 Android/iOS 真机、320px 窄屏、系统大字号、弱网与双账号用户验收。
- [x] 2.9 实施记录文档（差异、验证结果、回滚说明）：`docs/UX-EXPERIENCE-IMPLEMENTATION-20260930.md`。
