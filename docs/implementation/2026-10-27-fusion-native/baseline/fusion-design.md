---
name: 渐成习惯打卡 · 清爽日程融合原型
description: 已选 A 配色与优化后的 C 时间线布局，仅适用于本地 HTML 原型
colors:
  primary: "#246446"
  ink: "#18382c"
  muted: "#587065"
  pale: "#edf6ef"
  busy: "#c1decb"
  line: "#dce7df"
  paper: "#fff"
typography:
  headline:
    fontSize: "24px"
    fontWeight: 700
  body:
    fontSize: "15px"
    lineHeight: 1.5
  task:
    fontSize: "16px"
    fontWeight: 650
    lineHeight: 1.45
rounded:
  control: "10px"
spacing:
  gutter: "20px"
  compact-gutter: "16px"
---

# Design System: 清爽日程融合原型

## Overview

用户于 2026-10-27 选定「A的颜色+C的布局，C的布局也再优化下，和A融合融合」。本版使用 A 的绿白与薄荷色，保留 C 的时间列和纵向轨道，压紧统计与已完成行，固定任务和动作的对齐关系。选择依据见 [direction-approved.md](direction-approved.md)。

覆盖今日、进度、添加/编辑、详情、我的五页。[五页展示板](design-demos/fusion-board.html)用于整体查看，[交互原型](design-demos/fusion.html)用于操作。规则取自 `fusion.html` 的最终 CSS，后置融合覆盖优先于前置 C 布局基底。A/B/C 原始候选保留。

## Colors

深绿用于主打卡、当前导航与关键数字；薄荷浅面用于选中和轻提示，较深薄荷用于忙时记录。白色承载内容，深色正文、辅助文字与浅分隔线构成层级。原目标、忙时、未打卡与无样例同时配文字和形状区分。

## Typography

系统中文无衬线字体，不请求外部字体。标题、正文与任务名使用上述层级；窄屏任务名收至（15px），已完成任务名（14px），辅助说明（12–13px）。时间与统计采用等宽数字。长任务名可换行，动作列保持宽度。

## Layout

今日顺序为标题/日期、轻量完成摘要、时间线。摘要取消独立底色块，保留完成数、细进度与待做数。已完成项留在时间顺序中，可整体收起；完成行最小高（68px），待做行最小高（102px）。

时间线采用时间（42px）、轨道（16px）、内容三列。内容内的动作列（104px）固定在右侧，主打卡为单行（44px高），忙时入口独立占（44px高）；已完成行以撤销替换打卡动作。没有计划时间的任务单独标注，时间只决定排序。

原型最大宽（430px），桌面展示框（390×780px）。小于（360px）时左右边距采用 compact-gutter，时间/轨道收至（36/14px），动作列（100px），详情动作改单列。星期按钮保持（44×44px）并 flex 换行；（375px）页面无额外星期横向溢出。

## Elevation & Depth

以白底、薄荷选中面、分隔线形成层次。分段选中项、开关滑块和 Toast 保留局部轻阴影，时间线本体保持平面。

## Shapes

主打卡与添加入口使用 control 圆角，星期与次要入口小幅收紧。图标为统一线条 SVG，线宽（1.7px）；时间轨道以细线和圆点表达顺序与完成状态。

## Components

- 今日、进度、我的保持三项底部导航；添加/编辑与详情使用返回式子页。进度同时呈现原目标与忙时记录，今天与截至昨天的统计分别表达。
- 表单先呈现名称、平时目标、可选忙时目标、星期和开始日期，计划时间与备注放在更多设置。长期计划调整从明天生效；只调整今天保留原计划，缩减目标完成计为忙时。
- 可见操作保留至少（44px）热区；焦点使用深绿（3px）轮廓与（3px）偏移。控件短过渡保留，`prefers-reduced-motion` 时关闭动画和过渡。
- 打卡、撤销、表单和偏好仅存在当前窗口内存，刷新恢复合成样例。

## Do's and Don'ts

- **Do** 使用 A 的颜色角色与融合版的最终尺寸，保持五页一致。
- **Do** 保留计划与仅今天的不同语义，并用文字说明记录状态。
- **Don't** 将原型内存交互作为云端保存、账户隔离或原生页面实现的证据。

现有浏览器记录覆盖四种宽度的五页与（320px）长名称，共21组；异常、外网请求、存储访问、溢出、低对比度及不足44px操作均为0，九项交互通过，见 [fusion-verification.json](fusion-verification.json)。计划与仅今天的六项专项通过，见 [fusion-semantics-verification.json](fusion-semantics-verification.json)。独立视觉评审结论为 `ship`，范围为融合 HTML 原型；八张指定截图有效，约定项一致，无需重大修正，长名称滚动与 Toast 消失的补充证据通过。微信原生页面、真机、云端部署与发布尚未执行。
