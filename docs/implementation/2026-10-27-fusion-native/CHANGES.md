# 原生融合实现记录

日期：2026-10-27。实施分支：`dev`。

## 实现清单

- 默认薄雾绿接入已批准 A 配色；暖纸白保留，同一语义 token 生成两主题和导航/图标配色。新增 `build:ui` 串联主题、Tab 与菜单图标生成。
- 每次进入页面重新应用已确认的原生导航颜色；进入Tab页时同步底栏。暖纸白新增三个普通态Tab图标，与其辅助文字同色，保留原图形。
- 今日改为开放式完成摘要、独立置顶区和时间线。完成项默认展开，可整体收起；时间排序为表现层投影，保留无时间任务标注。待做/完成行最小高为 102px / 68px，普通/窄屏动作列为 104px / 100px。
- 今日与详情共用照片 controller 接入层及照片面板模板，保留 `ui.mutate` 云端确认、PHOTO_REQUIRED 回退、失败恢复、未知结果核对和确认订阅。详情加入平时/忙时打卡、撤销及今天目标调整的真实入口。
- 进度保留 7天、30天与月历数据及统计口径；近七天使用单位堆叠。详情显示真实 28天历史热图和可展开历史列表。
- 添加/编辑采用紧凑字段、忙时开关、星期选择与更多设置；工作日/每天两个快捷星期操作移入更多设置。开始日期等于首次安排时隐藏重复摘要，不同日仍给出真实首次安排。我的采用平面菜单组和“好友监督与分享”展开组。保留 20字名称、140字当天备注、5个同时进行习惯、长期编辑明天生效等限制。
- 其他十四页通过全局 token、字体、按钮及边界统一，保留原流程与功能门控。顶部导航与三项 TabBar 仍由微信原生组件承载。
- 冻结原型、五页截图、设计说明与哈希清单；原生正文按相同逻辑宽度与数据对照。根目录 `DESIGN.md` 与 `.impeccable/design.json` 记录实际设计系统。

## 证据与未完成项

基准为 `baseline/` 与 `baseline-manifest.json`，原生隔离证据在 `native/`。已取得四宽度双主题核心页截图；390px双主题248个关键配对矩形均≤2px。该证据使用隔离模拟数据，不能证明真实云端保存、真机或双账户行为。

`npm test`、`npm run check`、`npm run check:cloud`、OpenSpec严格校验与微信原生编译均通过。证据与复现方法见 `ACCEPTANCE.md`，最终验证结果见 `validation.json`。

已补充320px长名称、双主题大字号夹具与底部滚动，以及390px真实输入聚焦。仍待真机软键盘/系统字号、真实云端、双账户和用户对UI及业务交互的单独验收。

已知对照边界：原生安全区在当前 390px 环境贡献 34px 底部空间；导航与 TabBar 单列。标题层级依冻结稿采用主页面标题/习惯名 24px、返回行页面标题 22px。真实历史、表单限制、门控入口与合成原型存在内容和功能差异，不能据此删掉原生能力以追平页面总高度。

本地验收时尚未提交、推送、部署、合并或发布；后续 Git 状态以仓库记录为准。未修改服务端、云接口、身份认证、数据库和账户持久模型，无云数据迁移。

## 回滚范围

回滚只撤回本次实现差异，不重置整个工作区。先检查文件是否混入后续修改，再按差异恢复以下已有文件；不使用 `git reset --hard` 或宽泛目录清理。

```text
miniprogram/app.json
miniprogram/app.wxss
miniprogram/config/theme-tokens.js
miniprogram/styles/theme.wxss
miniprogram/assets/tabbar/today.png
miniprogram/assets/tabbar/today-selected.png
miniprogram/assets/tabbar/progress.png
miniprogram/assets/tabbar/progress-selected.png
miniprogram/assets/tabbar/mine.png
miniprogram/assets/tabbar/mine-selected.png
miniprogram/pages/appearance/index.wxss
miniprogram/pages/today/index.js
miniprogram/pages/today/index.wxml
miniprogram/pages/today/index.wxss
miniprogram/pages/progress/index.js
miniprogram/pages/progress/index.wxml
miniprogram/pages/progress/index.wxss
miniprogram/pages/mine/index.js
miniprogram/pages/mine/index.wxml
miniprogram/pages/mine/index.wxss
miniprogram/pages/edit/index.js
miniprogram/pages/edit/index.wxml
miniprogram/pages/edit/index.wxss
miniprogram/pages/detail/index.js
miniprogram/pages/detail/index.wxml
miniprogram/pages/detail/index.wxss
miniprogram/templates/task.wxml
miniprogram/services/appearance.js
miniprogram/services/ui.js
package.json
scripts/generate-tab-icons.cjs
tests/appearance-pages.test.cjs
tests/checkin-recovery.test.cjs
tests/core-experience.test.cjs
tests/gentle-return-pages.test.cjs
tests/theme.test.cjs
tests/transient-feedback.test.cjs
tests/ux.test.cjs
tests/search-public-pages.test.cjs
```

仅在确认仍为本轮新增且没有后续使用时，可移除以下文件。生成图标应与对应调用、脚本一并回滚，避免留下失效引用。

```text
DESIGN.md
.gitattributes
.impeccable/design.json
miniprogram/styles/fusion.wxss
miniprogram/services/checkin-ui.js
miniprogram/services/today-timeline.js
miniprogram/templates/photo-checkin.wxml
miniprogram/assets/tabbar/today-paper.png
miniprogram/assets/tabbar/progress-paper.png
miniprogram/assets/tabbar/mine-paper.png
miniprogram/assets/menu/book-mist.png
miniprogram/assets/menu/book-paper.png
miniprogram/assets/menu/clock-mist.png
miniprogram/assets/menu/clock-paper.png
miniprogram/assets/menu/list-mist.png
miniprogram/assets/menu/list-paper.png
miniprogram/assets/menu/message-mist.png
miniprogram/assets/menu/message-paper.png
miniprogram/assets/menu/people-mist.png
miniprogram/assets/menu/people-paper.png
miniprogram/assets/menu/sliders-mist.png
miniprogram/assets/menu/sliders-paper.png
scripts/build-ui.cjs
scripts/generate-menu-icons.cjs
tests/fusion-native-ui.test.cjs
qa/fusion-native.cjs
qa/fusion-compare.cjs
qa/fusion-board.cjs
qa/fusion-baseline-measure.cjs
qa/fusion-patch-capture.cjs
qa/fusion-source-proof.cjs
qa/fusion-focus-evidence.cjs
qa/fusion-evidence.cjs
openspec/changes/implement-fusion-native-ui/proposal.md
openspec/changes/implement-fusion-native-ui/.openspec.yaml
openspec/changes/implement-fusion-native-ui/design.md
openspec/changes/implement-fusion-native-ui/tasks.md
openspec/changes/implement-fusion-native-ui/specs/fusion-native-ui/spec.md
docs/implementation/2026-10-27-fusion-native/
```

最后一个目录仅指本次冻结基准、原生证据和本记录，建议保留证据后再撤销实现。用户原有 `PRODUCT.md`、`docs/designs/2026-10-27-ui-directions/` 及其他既有资料必须保留，不能随本次回滚删除。冻结 HTML 与截图不为迁就原生实现而修改；`.gitattributes` 只在确认不再需要基准换行保护时移除。回滚不触碰云数据，恢复客户端后重新运行常规检查与 OpenSpec 严格校验。
