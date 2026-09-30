# Tasks

执行入口：[proposal](proposal.md)；设计：[design](design.md)。每项取得证据后勾选；部署与真机项需单独授权。

## 1. 日历模块与数据核验

- [ ] 1.1 新增 `miniprogram/core/holidays.js`：年度表结构（holidays/workdays）、`isWorkday`、`scheduledOn`、`scheduleText`、未知年份回退与维护说明。
- [ ] 1.2 逐条核验 2025、2026 年国务院办公厅节假日安排公告并录入；新增结构自洽测试（日期合法、两表不相交、可覆盖跨年查询）。

## 2. 领域与判定接入

- [ ] 2.1 `core/habits.js`：`validatePlan` 接受可选 `dayType`（枚举）；`taskAt`、`firstExecution` 改用 `scheduledOn`；`weekdayText` 之上提供 `scheduleText`。
- [ ] 2.2 `services/gentle-return.js` 的应做日/错过判定改用 `scheduledOn`；领域与回归测试覆盖假期、调休、未知年份、旧计划不变四类场景。

## 3. 表单与页面

- [ ] 3.1 编辑页（紧凑与完整模式）：新增 工作日／非工作日 选项（替换"周一至周五"，保留自定义周几与每天）；摘要、提示文案同步；保存前后校验与容量逻辑不变。
- [ ] 3.2 详情页、管理页计划文案改用 `scheduleText`；分享预览支持 `dayType` 标签文案。

## 4. 服务端与分享投影

- [ ] 4.1 `server/protocol.js` 命令白名单接受 `plan.dayType`；`shared/habits.js` 校验与客户端一致；新增服务端合同测试（接受合法枚举、拒绝非法值）。
- [ ] 4.2 `server/features.js` 分享快照：`plan` 类型允许可选的 `dayType` 标签（不公开日期）；公开投影与失效路径回归。

## 5. 本地验证与收敛

- [ ] 5.1 运行 `npm run build:cloud`、`npm test`、`npm run check`、`npm run check:cloud`、`npm run openspec -- validate --all --strict` 并保存日志。
- [ ] 5.2 微信开发者工具验证：创建工作日/非工作日计划（含假期与调休日期用例）、摘要文案、统计口径变化。

## 6. 授权后的部署与真机

- [ ] 6.1 列出精确部署目标（`jiancheng_daka_api`，如涉分享投影含 `jiancheng_daka_features`）、配置差异与回滚边界，取得授权后部署并做真实云验收（保存/读取 dayType 计划、统计一致）。
- [ ] 6.2 真机验证：工作日计划在法定假期不出任务、调休日正常出任务；大字号与低端机表现。
