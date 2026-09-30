# Design

## Context

动机见 [proposal](proposal.md)。当前实现中"某天是否安排"的唯一判定是 `version.weekdays.includes(weekday(date))`（`core/habits.js` 的 `taskAt`），`services/gentle-return.js` 直接复用同一判断；统计（7/28 天）与首次执行日都由此派生，因此只要把这一个判定替换为统一的调度函数，全链路的口径即自动一致。

## Goals / Non-Goals

**Goals:** 工作日/非工作日与现实日历一致；旧数据零迁移、旧客户端行为不变；判定单点、可测试、每年可维护。

**Non-Goals:** 云端下发的动态日历、第三方节假日接口、按公司/城市日历、补班类特殊安排的自定义、农历。

## Decisions

### D1：内置年度日历表 + 安全兜底

新增 `miniprogram/core/holidays.js`：

```js
const YEARS = {
  2025: { holidays: ['2025-01-01', ...], workdays: ['2025-01-26', ...] },
  2026: { ... }
};
function isWorkday(date)      // 命中 workdays → true；命中 holidays → false；否则周一至周五
function scheduledOn(plan, date)  // dayType==='workday' → isWorkday；'restday' → !isWorkday；否则 weekdays 包含
```

- 表数据以国务院办公厅当年度公告为准，实施时逐条核验（2025/2026 两条公告），并以测试锁定表的结构自洽（日期合法、两表不相交、不含歧义项）。
- **未收录年份**回退"周一至周五＝工作日"：日历不更新也不阻塞打卡，只是假期不再特殊。
- 放随包文件而非云端：日历属于产品内容而非账户数据，离线一致、不新增集合与接口；年度更新随版本发布。替代方案（云端下发/第三方 API）引入新资源与网络依赖，不采用。

### D2：`dayType` 为可选字段，向后兼容

计划结构变为 `{ title, target, minimum, unit, weekdays, time, dayType? }`（`dayType` 缺省 `undefined`/`null`＝按星期）。选择工作日/非工作日时 `weekdays` 标准化为七天的占位值（不参与判定），使旧读取路径（分享投影、备份）仍能安全解析；`validatePlan` 仅在 `dayType` 为合法枚举时接受。

替代方案（替换 `weekdays` 或新建版本）产生迁移或双读逻辑，不采用。

### D3：判定与文案单点化

- 调度判定统一走 `scheduledOn(plan, date)`：`taskAt`、`firstExecution`、`gentle-return.missedScheduledDays`、统计（经 `tasksOn` 间接）全部改用它；不允许任何位置再直接读 `weekdays` 做日期判断。
- 文案统一走 `scheduleText(plan)`：每天／工作日（按法定节假日与调休）／非工作日／周一、周三……，供编辑摘要、详情、管理页、分享使用。
- 编辑页"工作日/非工作日/自定义（周几）/每天"四选；提示文案改为"工作日与非工作日按法定节假日和调休自动调整"。

### D4：统计、回归与分享口径

- 应做日分母、连续错过（≥2 个应做日）、首次执行日：天然随 `scheduledOn` 一致，无需另改算法；休息日仍不产生待做任务、不计漏做。
- 分享的轻计划（`kind: plan`）：`dayType` 计划公开 `{ dayType }` 标签（文案"工作日/非工作日"），不公开具体日期表；`weekdays` 公开逻辑保持不变（仅适用于按星期的计划）。

### D5：部署耦合与恢复

- `server/protocol.js` 的命令字段白名单必须接受 `plan.dayType`，共享领域校验（`shared/habits.js`）必须理解新字段——否则云端会以 INVALID_REQUEST 拒绝保存。因此**真实设备可用前需部署 `jiancheng_daka_api`**（分享投影涉及则含 `jiancheng_daka_features`）。
- 回滚：客户端可先回到不提供该选项的版本（旧计划行为不变）；云端校验对新字段向后兼容，无需数据回滚；日历表不更新只影响假期精度。

## Risks / Trade-offs

- [公告年度更新需发版] → 未更新年份安全回退，仅假期不特殊；模块头部注明维护说明与核验来源。
- [节假日数据人工录入出错] → 以官方公告逐条核验 + 结构自洽测试；错误只影响个别日期，不影响数据安全。
- [旧客户端 + 新数据] 与 [新客户端 + 旧云端] → 前者：旧客户端展示"按星期"文本但判定仍含 dayType?（旧端 `taskAt` 不识别 dayType）→ 处理：**云端就绪前不放开入口**（客户端开关与实现同步发布），并把该耦合记入 tasks 第 7 组。
- [分享投影泄露个人日期] → 只公开 dayType 枚举标签，不包含任何具体日期。
