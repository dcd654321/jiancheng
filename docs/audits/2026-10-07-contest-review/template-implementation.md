# 共享模板与记录语义实施记录

日期：2026-10-07。分支`dev`。变更：`refine-contest-product-experience`。范围为用户授权的本地体验实现；未部署、提交、推送、改云开关或写真实云端。

## Changes

- `miniprogram/config/habit-templates.js`新增共享新建模板：阅读5/1、步行10/3、复习5/2、整理3/1分钟。今日模板列表、首屏整理推荐、编辑表单和外观缩略图读取同一来源。查找只按明确key匹配，不读取原型属性。
- `miniprogram/pages/today/index.js`提供模板数据与整理主入口数据；每次显示按用户字号选择纵排标记，API缺失或异常回退普通布局。
- `miniprogram/pages/edit/index.js`仅本范围的import/模板赋值改动；会话表单草稿由主任务实现。新模板不修改已有习惯，也不改变AI基础方案5/2合同。
- `miniprogram/pages/appearance/index.js`及`index.wxml`使用共享阅读示例与相同的“已做…，记下”动作文案。
- `miniprogram/templates/task.wxml`已完成显示“本次记录X”，分列平时目标；未完成较小目标显示“今天目标X”。去掉“今天已调小”，不推断用户先执行过调目标。普通与忙时按钮明确自报记录。
- `miniprogram/services/ui.js`云确认后的toast改为“已记下/已记下·第一次/已记下·接上了”。继续保留当前串行锁、访问/账户上下文保护、撤销和未知结果语义。
- `miniprogram/pages/today/index.wxml`忙时数量描述改为“按忙时目标记下”；`miniprogram/pages/mine/index.js`帮助说明同步按钮文案与实际做完后再记录。
- `README.md`更新当前能力表与云端唯一持久、会话只读回退、AI客户端开启但生产未验、公开分享/提醒关闭的边界。
- `openspec/config.yaml`修正两句过时现状；schema、rules和operation guidance保持不变。

记录领域reducer、record schema、统计与服务端合同未改。直接忙时完成与显式调小后完成的记录仍没有来源差异；撤销仍保留较小的当天目标，界面按事实呈现并提供恢复原目标。

## Verification

新增`tests/habit-template-presentation.test.cjs`的5项回归：

1. 今日、四模板创建和外观示例数值一致，打开不创建习惯。
2. 现有30/10计划不迁移，只有显式创建才写入新5/1计划。
3. 无效模板key不会读取原型属性；AI基础建议保留5/2。
4. 直接忙时、先调小后完成、普通完成和撤销均用实际WXML表达式展示数量，不能声称已主动调小。
5. 字号设置变更后重入更新纵排标记；能力缺失/异常回退安全。

原有默认值、记录文案与toast/帮助断言已同步，未放宽账户、幂等、写入确认或恢复测试。

定向命令：

```powershell
node --test tests/habit-template-presentation.test.cjs tests/ux.test.cjs tests/appearance-pages.test.cjs tests/gentle-return-pages.test.cjs tests/startup-pages.test.cjs tests/workspace.test.cjs tests/pages.test.cjs
git diff --check
```

结果：106/106通过，无skip；diff检查无错误。`git diff --numstat -- miniprogram/core/habits.js server`为空，确认本范围未改领域reducer或服务端。Git行尾提醒不影响测试结果。

全量test/check/check:cloud/OpenSpec严格校验、原生编译及改版截图由主任务汇总。当前结果只说明本地回归，不等于真机字号、键盘、读屏、真实AI、云端或用户验收。OpenSpec 2.1/2.2还包含其他页面与截图证据，完成勾选由主任务取得整项证据后处理。

## Rollback

通过Git差异逐文件回退上述模板、呈现和文案改动；共享配置回退时同时恢复使用它的页面import/数据，避免缺少依赖。已有云端计划未迁移，无数据回滚步骤。本记录对应的测试随行为一并回退，保留本次审查与操作证据。
