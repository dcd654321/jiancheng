# 进度页直接显示全部习惯

2026-10-11，`dev` 本地界面调整。已获取 `origin/dev`，本地与远端提交一致，保留已有未提交修改。

“每个习惯的打卡”清单直接显示当前统计周期内的全部习惯。移除前三项限制、“还有几个习惯 · 查看”和“收起更多习惯”入口，并清理 `showHabits`、`onToggleHabits` 及 `.review-more`。各习惯仍可点击查看详情，近 7 天/近 28 天切换和统计计算沿用既有实现。

修改 `miniprogram/pages/progress/index.wxml`、`index.js`、`index.wxss`。`tests/ux.test.cjs` 移除旧折叠调用，保留统计结果及只读状态校验。

验证：`npm test` 446/446；`npm run check` 356 项；`npm run check:cloud` 52 个文件一致；OpenSpec strict 21 个变更通过；微信原生 `wcc` / `wcsc` 各 15 个输入通过；本轮文件 `git diff --check` 通过。本轮未运行模拟器截图、真机或真实账户验收，未上传、部署、提交推送或发布。

回滚仅恢复进度习惯清单的三项限制、展开入口及对应状态、方法、样式和旧断言，保留其他修改。
