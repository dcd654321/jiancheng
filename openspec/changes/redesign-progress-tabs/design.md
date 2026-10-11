# Design

## Context

见 proposal.md。当前 progress 页调用只接受7/28天的 domain.summary；云端已确认 state 含完整保留习惯、版本、记录。领域函数 versionAt/taskAt 是历史计划来源；ui.withLifecycle 管理显示版本、账户读取、主题和跨午夜。详情只接受habit id，历史日明细须直接在月历下呈现。

## Goals / Non-Goals

**Goals:** 客户端只读投影，日历与统计共用日期口径，保留原summary与分享合同，双主题与小屏可用。

**Non-Goals:** 增加持久快照、云查询、调休日程或历史写操作。

## Decisions

- 新增 core/progress-review.js：summarizeRange(state,{start,end,today}) 返回 cells、habits、totals、closed、todayCell；buildMonth(state,{month,selectedDate,today}) 返回月格及选中日完整习惯。独立客户端模块避免改变领域summary及云副本。每天原目标/忙时柱高为各档次数除以当天安排，休息日独立标记。
- 日记录逐habit按createdDate和versionAt投影；未生效计划用首版本介绍并标尚未开始。历史title/target/unit/note来自当日版本与记录。相关统计习惯为周期有安排/记录及今天active习惯（包括明天开始）；同名用目标/星期区分。截至昨天计数与今日状态分别标注。
- Tab值week/month/calendar，days为7/30；选择仅保存在页面内存。账号context变化重置投影；跨午夜若选择原今天则跟随今天，历史选择保持。日期picker记录打开时context/showVersion/generation，回调核对；所有月份输入与边界重新校验。
- 农历模块core/lunar-date.js提取solarlunar3.1.0固定commit df2cbf9851ac631fdeeb9ba08325ef8fed97a43d的数据表及必要转换，保留ISC许可证，不引入npm构建。农历覆盖1900-01-31..2100-12-31；格内优先节日、初一月份、农历日。传统节日白名单春节/元宵/端午/七夕/中秋/重阳/腊八；除夕依次日春节判定，排除闰月，不使用上游getFestivals。
- 两个统计Tab共享周期摘要和习惯清单，日历显示所选日明细。月历首尾空白格补到整周，今日/选中/未来分别标识。320px月历局部扩宽至屏幕左右各6px，无列gap，七格至少44px；不复用旧338px横滚样式。日记录按钮只用于查看习惯，备注直接可见。
- 沿用现有advise规则但传入closed数据，有安排日少于3天无建议。不引入环比排名或未经记录支持的推断。
- 进度页读取系统fontSizeSetting，以16为基准将字号放大到最多2倍，异常或缺失时使用默认字号；单元格只设最小高度，月份标题在大字号时独占一行。忙时趋势与图例使用一致斜纹，配合次数文字区分两档。

## Risks / Trade-offs

- [主摘要包含今天、比率截至昨天] → 两处明确写出含今天/截至昨天，今日另列，习惯X/Y仅用closed口径。
- [未来日期与新建未开始习惯] → 日期格显示未到，完整日记录标只读安排/尚未开始，不算漏做。
- [读取失败] → 保留ui.read三态和确认快照只读边界，未确认状态不生成零统计。
- [现存未提交改动] → 只修改本变更拥有的文件和必要旧测试；不覆盖其他功能。

## Migration Plan

不涉及数据迁移或云部署。回滚只恢复progress页及相关测试并移除新增客户端模块，保留所有云数据和原summary。提交推送、部署、发布与归档等待对应授权及用户验收。
