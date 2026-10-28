---
name: 渐成习惯打卡 · 清爽日程融合
description: A 的绿白配色与 C 的紧凑时间线，应用于原生微信小程序
colors:
  primary: "#246446"
  ink: "#18382C"
  secondary: "#587065"
  page: "#FFFFFF"
  surface: "#FFFFFF"
  on-primary: "#FFFFFF"
  busy-bg: "#EDF6EF"
  busy-text: "#246446"
  busy-fill: "#C1DECB"
  soft: "#F7FAF7"
  line: "#DCE7DF"
  control-border: "#7A897D"
  field-border: "#C6D8CC"
  chart-border: "#CBDACF"
  accent-border: "#B6CDBF"
  error: "#A23C2E"
  error-bg: "#FFF1EC"
  paper-primary: "#79604F"
  paper-ink: "#39352F"
  paper-secondary: "#70695F"
  paper-page: "#FAF8F3"
  paper-surface: "#FFFEFA"
  paper-busy-bg: "#F0F1E7"
  paper-busy-text: "#606449"
  paper-busy-fill: "#D4D6B9"
  paper-soft: "#F3F0EA"
  paper-line: "#E6E0D6"
  paper-control-border: "#998A7D"
  paper-field-border: "#C8BEB0"
  paper-chart-border: "#D9D4C8"
  paper-accent-border: "#C8BEB0"
  paper-error: "#A33D2A"
  paper-error-bg: "#FFF1EB"
typography:
  headline:
    fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: "24px"
    fontWeight: 700
    lineHeight: 1.32
  navigation-title:
    fontSize: "22px"
    fontWeight: 700
    lineHeight: 1.32
  body:
    fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: "15px"
    lineHeight: 1.5
  title:
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.45
  task:
    fontSize: "16px"
    fontWeight: 650
    lineHeight: 1.45
  task-completed:
    fontSize: "14px"
    fontWeight: 500
  label:
    fontSize: "13px"
    lineHeight: 1.5
  caption:
    fontSize: "12px"
rounded:
  control: "10px"
  field: "9px"
  compact: "8px"
  chip: "5px"
  photo-panel: "16px"
spacing:
  gutter: "20px"
  compact-gutter: "16px"
  section: "24px"
  group: "12px"
  control-gap: "8px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.control}"
    padding: "9px 14px"
    typography: "{typography.body}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "9px 14px"
  button-add:
    backgroundColor: "{colors.busy-bg}"
    textColor: "{colors.primary}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
  input-edit:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.field}"
    height: "48px"
    typography: "{typography.body}"
  chip-busy:
    backgroundColor: "{colors.busy-bg}"
    textColor: "{colors.busy-text}"
    rounded: "{rounded.chip}"
    padding: "2px 7px"
    typography: "{typography.label}"
  container:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.control}"
  timeline-checkin:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.control}"
    width: "104px"
    padding: "8px 3px"
---

# Design System: 渐成习惯打卡 · 清爽日程融合

## Overview

**Creative North Star: "清爽日程融合"**

用户选定 A 的颜色与优化后的 C 时间线。原生页面以白色内容面、克制的绿色状态、细分隔线和稳定的动作列承载日常记录。密度紧凑，任务名称与打卡动作先被看到，次要设置逐步展开。

这是已实施客户端的设计记录。薄雾绿为默认主题，暖纸白只替换语义颜色，两者共用页面结构、尺寸和交互。顶部导航与今日、进度、我的三项底栏由微信原生组件承载。

**Key Characteristics:**

- 真实安排组成时间线，完成项默认展开，置顶任务独立呈现。
- 颜色、文字和形状共同表达原目标、忙时、未打卡与无安排。
- 紧凑字号与间距配合至少 44px 的主要操作热区。
- 表现层沿用云端确认与结果核对，不以动画或本机假状态宣告保存。

## Colors

深绿、薄荷与白色构成默认主题；暖纸白使用同一套语义角色。上方 token 是本文的规范数值，运行时唯一来源为 `miniprogram/config/theme-tokens.js`，由 `scripts/build-themes.cjs` 生成 `miniprogram/styles/theme.wxss`。

### Primary

- **沉稳叶绿**（primary）：主打卡、主要提交、选中导航、原目标记录和关键数字。
- **浅薄荷**（busy-bg / busy-text）：选中面、轻提示与忙时标签。
- **柔薄荷**（busy-fill）：忙时记录的图表填充，与原目标深绿分开。
- **暖纸棕**（paper-primary）：暖纸白主题内对应的主要操作和记录状态。

### Neutral

- **林下深墨**（ink）：正文、任务名与表单值；secondary 承载辅助文字。
- **白色内容面**（page / surface）：页面与内容；soft 承载低强调提示。
- **淡叶分隔线**（line）：列表和分组边界；control-border、field-border、chart-border 与 accent-border 分别用于控件、表单、图表与轻动作。
- **暖纸与褐墨**（paper-*）：替换相应背景、正文、边界与状态角色，不引入第二套布局。
- **土红错误色**（error / error-bg）：错误文本和浅错误面，始终配具体问题及恢复动作。

**The Semantic Theme Rule.** 页面使用语义颜色变量；同一状态在两个主题中保留相同文字、形状与布局。

## Typography

**Display Font:** 系统中文无衬线字体，使用 headline 的字体栈。
**Body Font:** 同一系统字体栈，不请求外部字体。

字重和尺寸区分页面、任务与辅助信息；时间、数量和统计使用等宽数字。主页面标题与详情习惯名采用 headline，返回式子页的返回行标题采用 navigation-title，与冻结稿的标题层级保持一致。

### Hierarchy

- **Headline**：页面标题。详情中的习惯名同为标题级，行高采用（1.4）以支持长名称。
- **Navigation title**：详情和添加/编辑返回行中的页面名称，不代替详情正文中的习惯名。
- **Title**：分区标题与记录列表名称。
- **Task**：时间线待做任务；完成任务降至 task-completed；小于（360px）时待做任务名采用（15px）。
- **Body**：表单值、主要按钮与日常正文。
- **Label / Caption**：辅助说明、时间、日期、忙时入口和图例。关键信息不靠缩小字号挤进固定高度。

进度页按系统字号设置缩放；今日和详情保留其大字号样式。长名称允许换行和增高。

## Layout

页面主体最大宽（560px），居中；融合样式顶部内边距（18px），常规左右边距使用 gutter，小于（360px）使用 compact-gutter。底部内边距为（24px）加 `env(safe-area-inset-bottom)`。原生导航和底栏单独占位，不能用 HTML 演示框的总高度代替正文可用高度。

今日依次呈现标题/日期、开放式完成摘要、独立置顶区与时间线。时间线为时间（42px）、轨道（16px）、内容三列，内容内固定动作列（104px）。待做行最小高（102px），完成行最小高（68px）；长名称可以自然增高。小于（360px）时列宽收至（36px / 14px / 100px）。

完成项默认展开，整体收起只改变可见投影；置顶与普通任务分别按计划时间排序，同时间以 ID 稳定排序，没有计划时间排在普通时间任务后并单独标注。时间只决定排序，不承诺自动提醒。

添加/编辑页先呈现名称、平时目标、可选忙时目标、星期及开始日期，计划时间与工作日/每天两个快捷星期操作进入更多设置。开始日期等于首次安排时不重复显示首次安排摘要，不同日时保留真实首次安排。星期按钮保持（44px）热区，小于（380px）改为四列换行；提交按钮留在内容流。详情双动作列小于（360px）改单列。我的以平面分组行组织入口，监督与分享共用可展开组。

## Elevation & Depth

主体依靠纯色浅面、细分隔线和状态色形成层级，不使用装饰性外投影。聚焦输入框使用内侧主色轮廓，错误框配错误边界与文字；照片面板使用半透明遮罩和顶部圆角表达受保护的操作层。按钮按下通过浅面或实心色内侧加深反馈。

**The Flat Content Rule.** 时间线和日常列表用内容对齐与分隔线建立层级，不叠加阴影卡片。

## Shapes

共用容器与主操作采用 control 圆角；编辑字段略收紧至 field，次要动作采用 compact。状态标签小圆角，照片面板只在顶部使用 photo-panel 圆角。保留的模板卡与启动骨架有（14px）局部圆角，不能把这些局部例外推导为时间线卡片。

时间轨道采用（1px）细线与空心圆点；完成圆点填充主色并带勾形。导航与菜单图标从同一线条几何生成本地 PNG，菜单按主题生成，不能用 emoji 替代。

## Components

### Buttons

主要提交与时间线打卡为实心主色，白字；次要操作采用描边或文字。共用主按钮最小高（44px），编辑提交为（48px），时间线主动作保持（44px）。忙时动作独立保留（44px）热区；完成后替换为撤销。加载时阻止重复提交，未知结果继续显示核对入口，错误提供重试。

### Chips

忙时与轻提示使用浅面和对应文字色。标签本身不是可点击控件时，不将标签尺寸当作操作热区。原目标与忙时图表配图例，未打卡与无安排分别表达。

### Cards / Containers

共用容器使用 surface 和（1px）line 边界；今日时间线、详情计划与我的菜单保持开放式列表。照片面板为独立遮罩层，沿用共用照片模板。

### Inputs / Fields

普通输入最小高（44px），编辑主字段为（48px）。编辑字段使用 field-border，焦点以（2px）主色内轮廓表达，错误态增加错误色边界与文字。原生 input 取消垂直 padding 以保留原生居中。名称保留（20字）限制，详情当天备注保留（140字）限制。

### Navigation

微信原生顶部导航与三项 TabBar 始终保留；选中项使用 primary，未选项使用 secondary。导航底色使用 page，Tab底色使用 surface。进入页面时重新应用已确认主题，两主题各有普通与选中图标。详情和编辑保留返回动作，失败时可返回今日。界面图标由 `npm run build:ui` 随主题生成。

### Timeline and confirmed check-in

`today-timeline.js` 仅投影已确认任务，不修改领域任务或持久状态。今日与详情通过 `checkin-ui.js` 复用照片 controller 和 `photo-checkin.wxml`，经 `ui.mutate` 使用既有云端确认、PHOTO_REQUIRED 回退、未知结果恢复与 `subscribeConfirmed` 核对。账户、日期与页面版本变化后，迟到响应不能覆盖当前输入。

详情提供平时/忙时打卡、撤销、只调整今天目标、备注、计划与真实历史；近（28天）热图来自真实任务状态，历史列表按需展开。进度保留真实（7天 / 30天 / 月历），区分截至昨天与今天。长期计划编辑明天生效，今天调整保留独立语义；同时进行的习惯上限仍为（5个）。

菜单行最小高（62px）；首页短句开关所在行至少（64px），label提供（44px）触控区域。详情历史明细的展开入口位于更多操作。

### Remaining pages

discover、template、manage、sync、data、share-create、share-list、share-view、reminder、appearance、supervision、supervision-invite、supervision-detail、photo-record 共十四页通过全局颜色、字体、按钮、分组与边界统一。功能入口继续按原有门控显示，未将原型预览替换为真实能力承诺。

## Do's and Don'ts

### Do:

- **Do** 使用语义 token 与同一套双主题布局。
- **Do** 保持任务、时间轨道与动作列的对齐，长内容允许增高。
- **Do** 用文字和形状补充状态色，主要操作保留至少 44px 热区。
- **Do** 依据云端确认显示保存结果，给待核对、错误、加载和空状态明确入口。

### Don't:

- **Don't** 将原目标、忙时目标、只调整今天与明天生效合并为同一个动作。
- **Don't** 为对齐截图裁剪真实任务、历史或已启用入口。
- **Don't** 将隔离模拟器、HTML 原型或自动测试写成真实云、真机、双账户或用户验收。
