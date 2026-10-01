# 完成反馈与临时交互修复记录

日期：2026-10-01。分支：`dev`。开始时已执行 `git fetch origin dev`，本地与 `origin/dev` 相差0/0。工作区已有页面、主题、测试及文档修改；本轮在其基础上增量修复，未提交、合并或部署。

## 问题与结果

| 问题 | 修复后的行为 | 主要文件 |
| --- | --- | --- |
| 完成反馈常驻，刷新持续派生相同提示 | 最新确认项显示5秒后收起；刷新不延长；分组记录和长期撤销入口保留 | `miniprogram/pages/today/index.js` |
| 连续完成后撤销最新项，会再次显示上一项反馈 | 撤销最新项清空临时ID与定时器，旧项不重新弹出；忙时目标与随手记继续保留 | `miniprogram/pages/today/index.js` |
| 离页后或离页重入后，旧写入回执弹成功/错误，功能预览重新打开 | 回调同时检查发起账户、可见性和onShow版本；已发操作允许完成，操作锁最终释放，权威记录由当前页面读取 | `miniprogram/services/ui.js`、`miniprogram/services/feature-page.js`、`miniprogram/pages/detail/index.js` |
| 保存表单后离页，迟到回执强制返回或切换到今日 | 只在发起保存的同一可见访问跳转或显示反馈，输入与当前页面保留 | `miniprogram/pages/edit/index.js` |
| 旧恢复请求失败，把重新进入后已显示数据的页面覆盖成不可用 | 恢复结果按发起访问隔离，finally释放重试锁 | `miniprogram/services/ui.js` |
| 重新提交记录时仍显示上一轮失败文案 | 开始新操作时清除旧错误，当前失败再显示对应原因 | `miniprogram/services/ui.js` |
| 调整目标、修改状态、放弃草稿、双重删除确认的旧回调仍能提交 | 访问或账户变化后，旧确认不改数据、不删草稿、不继续弹出后续确认 | `miniprogram/services/ui.js`、`miniprogram/pages/detail/index.js`、`miniprogram/services/data-actions.js` |
| 旧订阅确认及分享管理失败回调干扰重入页面 | 订阅回调不得在新访问登记旧意图，分享失败不覆盖重入内容 | `miniprogram/pages/reminder/index.js`、`miniprogram/pages/share-view/index.js` |

临时反馈在隐藏、卸载、日期或账户变化时同时清理ID与定时器。没有增加定时业务写入；新定时器仅用于页面提示收起。分享、提醒、AI能力保持原配置。

## 验证

最初新增的13个针对性场景在修复前全部失败。后续补充草稿、置顶、订阅和分享管理场景；本轮新增17个回归测试，覆盖5秒边界、连续完成重置、刷新不复活、撤销旧项不再展示、隐藏/卸载/跨日/context清理、迟到成功与失败、表单导航、旧确认及恢复失败。

- `npm test`：354/354通过，0失败、0跳过。完整本机输出位于 `docs/audits/2026-10-01-transient-feedback/npm-test.log`。
- `npm run check`：327项语法/配置/页面检查通过。
- `npm run check:cloud`：61个云文件与源码一致。
- `npm run openspec -- validate --all --strict`：15项全部通过。
- `git diff --check`：无差异格式错误。

关键用例位于 `tests/transient-feedback.test.cjs`，订阅与分享回归位于 `tests/reminder-pages.test.cjs`、`tests/share-pages.test.cjs`。已有 `tests/ux.test.cjs` 将“撤销后回退旧反馈”改为“清空反馈”的预期；原有确认、拒绝、取消、双重删除、忙时撤销等场景继续通过。

本轮证据为本地自动执行。微信工具原生编译与模拟器、真机、真实双账户和用户验收未执行；此前截图不计入本次修复验证。云端代码与资源未修改，未执行部署或真实数据清理。

## 手工复测与恢复

1. 在微信开发者工具重新编译；完成一项，确认立即归入“今日已完成”，底部反馈显示目标与撤销。
2. 等待5秒，确认底部反馈收起，已完成分组仍可撤销；刷新后反馈不重新出现。
3. 连续完成两项，在5秒内撤销最新项，确认提示清除且上一项不重新弹出。
4. 请求延迟时切换页面再返回，确认迟到回执不弹旧提示、不强制跳转；当前记录与权威状态一致。

本轮修改清单：上述8个客户端文件，3个既有测试与新增 `tests/transient-feedback.test.cjs`，本记录，既有交接/验收文档及 `refine-journey-and-add-themes` 的proposal/design/journey规范/tasks。恢复时仅反向应用本轮增量；这些文件部分已有用户修改，不能整文件checkout或重置工作区。没有数据库迁移或云端恢复步骤。
