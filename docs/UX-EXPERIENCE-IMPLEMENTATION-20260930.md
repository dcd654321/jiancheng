# 核心体验优化实施记录（2026-09-30）

对应提案：`openspec/changes/redesign-core-experience/`（proposal、design、4 份 spec delta、tasks）。
依据：`docs/UX-DESIGN-REVIEW-20260930.md`；用户已授权按报告全部实施，部署、合并与真机验收仍单独安排。
分支：`dev`；工作区原有未提交修改（README 与多份 docs）未被覆盖，本记录与代码改动均为新增或独立文件。

## 1. 变更清单

### 首次进入与今日（最高频路径）

- `pages/today/index.wxml`：空状态重做——价值标题"再忙，也能做一点"、四张双档模板卡（读一会儿 5/2、走路一会儿 10/3、复习一小段 5/2、整理桌面 3/1，数字与 `edit/index.js` 模板表一致）、"自己填写"次按钮、"不知道定多大？"辅助行；无习惯时隐藏页头"添加习惯"。新增今日进度卡（"今天的进度 N / M"＋进度条＋忙时完成说明）、"待做 N 项"计数标题、加载骨架与"暂时读不到云端记录／数据没有丢失。检查网络后重试。"失败文案；短句仅在存在任务且非回归状态时显示。
- `templates/task.wxml`：任务卡两行结构（名称＋「打卡」胶囊；"今天 X 单位"＋青柠"忙时 Y 单位"标签），调小时显示"（原 X）"；未完成时动作行给出「按忙时目标打卡 · Y」软按钮与"今天少做一点"；完成后显示"忙时完成／原目标完成"与"撤销打卡"。`detail` 模式仅影响标题是否可点击。
- `pages/today/index.js`：回归卡"按原目标打卡"由跳转详情改为直接完成当天记录，新增"用忙时目标打卡"（`completeMinimum`）；今天已留下任一记录后不再显示回归卡（欢迎回来只做一次破冰）。原位 6 秒撤销条改为卡片样式，完成标记带一次进入动画（`.stamp-in`）。
- `services/ui.js`：`completeMinimum` 提示与普通完成提示改为"记下了 · 已同步"，首次"第一次，记下了 · 已同步"，回归"接上了 · 已同步"；显示时机仍为云端确认之后，条件未放宽。

### 创建与编辑

- `pages/edit/index.wxml`、`services/plan-form.js`、`pages/edit/index.js`：模板说明改为"已按模板填好名称、目标与忙时目标，都可以修改。"；目标提示压成一句"完成后点「打卡」；不会自动计时或累计。"，范围进入占位符与错误提示；忙时目标提示一句化；"首次安排／修改生效"摘要加粗；说明文字统一为 12px `.field-hint`。

### 进度

- `pages/progress/index.wxml|js`、`core/date.js`：日期区间改"9月24日 – 9月30日"（新增 `date.shortLabel`）；空数据只显示说明与"创建习惯"主按钮，不再渲染日历、图例与选中日明细；指标为"X 次已完成／共安排 Y 次"＋"原目标 A 次 · 忙时目标 B 次 · 记录率 C%"；图例"尚未完成"改"未记录"并补虚线"无安排"色块；脚注改为"含今天；今天还没有结束。忙时目标也算一次记录，不等于完成原目标。"
- 新增 `core/progress-advice.js`：纯规则建议（只用 planned／standard／minimum 与计划日数），计划日少于 3 天不输出；文案标注"根据最近记录，不会自动调整你的目标"。

### 术语与状态

- `core/habits.js`：`statusText` "简化完成"→"忙时完成"，读屏描述"简化"→"忙时"，校验文案改为"忙时目标／今天的目标"。
- `pages/sync/index.json|wxml|wxss`：标题与页面统一为"云端状态"，状态信息收进白卡。
- `pages/progress|mine/index.json`：Tab 页导航标题统一"渐成习惯打卡"；编辑已有习惯时导航标题为"编辑习惯"（既有实现保留）。
- `services/features-client.js`、`services/plan-assistant.js`、share/reminder 页：错误文案"数据同步"→"云端同步"。
- `pages/mine`：副标题改"记录跟随当前微信账号"；帮助文案按开关描述一键与两步两条路径。
- `pages/assistant`：入口说明改"不知道定多大？先回答两个问题，拿一个建议方案。"；首屏只留一句来源说明；"不承诺…"移入预览页脚。
- `pages/detail|manage|data`：读取失败标题统一"暂时读不到云端记录"；详情更多操作与历史记录收进白卡。

### 视觉系统

- `miniprogram/app.wxss`：token 化——页面底色 `#F6F8F5`、白卡圆角 16 与统一阴影、二级文字统一 `#57675E`、微字与图标灰统一 `#7C8B81`、分割线 `#E7EDE6`、青柠 `#DDF3A4`（仅忙时目标相关元素）、字号下限 12px；新增 `.card/.list-card/.check-pill/.soft-button/.chip-lime/.tpl-card/.skeleton/.advice/.stamp-in` 等组件；标题层级 24/26px，指标 40px。
- `config/cloud.js`：test 与 product 目标启用 `completeMinimumEnabled: true`；`services/ui.js` 仍以"专属云函数＋显式开关"双重条件判定，旧云分支与测试保留。
- `cloudfunctions/*/shared/{habits,date}.js`：由 `npm run build:cloud` 从 `miniprogram/core/` 重新生成，未手改副本。

### 测试

- 更新 `tests/ux.test.cjs`（9 处）、`tests/pages.test.cjs`（3 处）、`tests/gentle-return-pages.test.cjs`（回归卡行为重写＋新增忙时接上用例）、`tests/workspace.test.cjs`（toast 断言）。
- 新增 `tests/core-experience.test.cjs`（8 个用例）：日期短格式、建议五种分支、进度页集成、空状态结构、开关配置、导航与命名、旧词扫描。

## 2. 与审查稿（原型）的明确偏离

1. 星期按钮保留 4+3 网格（`repeat(4)`），不采用原型 7 列一行：320px 宽下 7 列单键约 35px，低于可接受触控宽度；4+3 网格为当前已验证形态。
2. 回归卡按钮文案含"打卡"二字（"按原目标打卡 · 5 分钟／用忙时目标打卡 · 2 分钟"），使"点击即记录"的语义在标签上明确。
3. 建议句第二个分支改为"先按这个节奏保持一周"，避免与"忙时目标"概念再引入"小目标"别名。
4. 完成动画只出现在今日原位撤销条的完成标记上（详情页与已完成分组使用静态标记），避免展开分组时整列重播动画。

## 3. 验证结果（2026-09-30，本地）

| 项 | 结果 |
| --- | --- |
| `npm test` | 286 项通过，0 失败（原 274 项 + 15 项新增/改写净变化） |
| `npm run check` | PASS 295 syntax/config/page checks |
| `npm run check:cloud` | PASS 61 cloud files match source |
| `npm run openspec -- validate --all --strict` | 13 项通过（含本变更） |
| 原生编译 `scripts/check-native.cjs` | wcc 15 个 WXML 输入、全部 WXSS 通过 |
| WXML 类名与 WXSS 定义一致性 | 全部已定义（脚本核对） |

未执行（不得计为通过）：云端部署与 `completeMinimum` 真实回执核验、模拟器点击与截图复查、真机／大字号／窄屏／弱网／双账号验收。旧词扫描确认 "简化／小目标完成／数据同步／已保存到云端" 不再出现在启用页面的用户可见文案中。

## 4. 回滚说明

- 代码回滚：本批改动集中在 `dev` 工作区，尚未提交；如需回退按文件恢复即可。无数据库迁移、无云函数源码变更（`cloudfunctions/*/shared/*` 仅为 core 的再生成副本）。
- 开关回滚：将 `config/cloud.js` 两个目标中的 `completeMinimumEnabled` 改为 false，即可隐藏"按忙时目标打卡"，回到"今天少做一点"两步流程（该分支与测试保留）。
- 部署边界：本次未部署、未推送、未合并 `main`；`completeMinimum` 的云端可用性声明以部署后的真实回执核验为准。
