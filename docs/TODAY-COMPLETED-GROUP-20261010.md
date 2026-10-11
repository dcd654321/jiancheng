# 今日已打卡整体卡片

2026-10-10，`dev` 本地文案和样式调整。

## 页面显示

- 去掉今日页“做完再打卡，不会自动计时。”及其空白间距；“我的”帮助继续提供操作说明。
- “今日已打卡”标题和记录置于同一个白底、细外框、16px 圆角容器，左右留白对齐。
- 展开时标题底部和记录之间使用细分隔线；标题与清单之间没有外部间隙或重复圆角。
- 收起时只显示同一容器内的标题，保留数量、展开状态与按下反馈。记录仍提供详情和撤销入口，原打卡等待颜色保持。
- 根据后续用户截图修正底色：标题不再复用带独立圆角框的 `disclosure` 样式，标题、列表和每一行显式使用同一个 `--color-surface`；外边框与圆角仅由分组容器提供。

修改 `miniprogram/pages/today/index.wxml`、`index.wxss` 及对应的既有文案断言，未修改数据或云端行为。开始前已获取 `origin/dev`，本地与远端提交一致；保留工作区已有修改。

## 验证

`npm test` 446/446、`npm run check` 350 项、`npm run check:cloud` 52 个文件、OpenSpec strict 21 个变更均通过；微信原生 `wcc` / `wcsc` 各 15 个输入通过，输出 164153 / 34232 字节。`git diff --check` 通过，目标提示及 `task-explain` 在今日页零命中。

微信原生模拟器使用复制自当前源码的今日页 WXML、WXSS、共享任务模板和主题样式，账户状态为隔离内存数据，不初始化云服务或访问本机存储。薄雾绿四层背景均为 `rgb(255, 255, 255)`，暖纸白均为 `rgb(255, 254, 250)`；两套主题的展开、收起、重新展开均通过，截图已逐张检查。

截图及颜色读取结果见 [observations.json](audits/2026-10-10-completed-surface/observations.json)，薄雾绿 [展开](audits/2026-10-10-completed-surface/mist-expanded.png) / [收起](audits/2026-10-10-completed-surface/mist-collapsed.png)，暖纸白 [展开](audits/2026-10-10-completed-surface/paper-expanded.png) / [收起](audits/2026-10-10-completed-surface/paper-collapsed.png)。该证据验证原生模板和显示，真实账户及真机最终绘制待验收。未上传客户端、部署、提交推送或发布。

## 回滚

仅回退本轮今日页分组容器、标题和清单样式、提示文案及对应旧断言；保留此前等待按钮颜色和工作区其他修改。
