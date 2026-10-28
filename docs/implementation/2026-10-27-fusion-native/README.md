# 融合版原生落地与还原验收

2026-10-27至28日，`dev` 本地实现。主色与正文参数来自已确认融合稿，业务记录继续由既有云端确认流程提供。

## 改动与基准

- 今日、进度、添加／编辑、详情、我的采用融合布局；其余14页复用统一主题、字号、按钮与分组参数。
- 薄雾绿与暖纸白共享结构，主题、导航与菜单图标可用 `npm run build:ui` 一起生成。
- 今日置顶单列，其余按计划时间排序，无时间置后；完成项默认展开，可收起。
- 今日与详情共用照片上传、约束、结果核对和云确认。详情支持打卡、忙时、撤销、只改今天与恢复原目标。
- 进度使用真实7天、滚动30天及月历；详情使用真实28天热图与可展开的历史明细。更多操作内保留原有分享、监督、暂停、归档和删除确认。
- 添加页保留20字名称、可选忙时目标、容量、开始日期、输入草稿和编辑明天生效规则；备注仍限140字。

冻结文件位于 [baseline](baseline/)，SHA256 记录在 [baseline-manifest.json](baseline-manifest.json)。实施未修改冻结原型或其来源。参数和组件见根目录 [DESIGN.md](../../../DESIGN.md)，完整改动及回滚范围见 [CHANGES.md](CHANGES.md)。

## 原型与原生对照

| 页面 | 薄雾绿对照 | 暖纸白对照 |
| --- | --- | --- |
| 今日 | [并排图](native/final-390-mist-today-pair.png) | [并排图](native/final-390-paper-today-pair.png) |
| 进度 | [并排图](native/final-390-mist-progress-pair.png) | [并排图](native/final-390-paper-progress-pair.png) |
| 添加 | [并排图](native/final-390-mist-edit-pair.png) | [并排图](native/final-390-paper-edit-pair.png) |
| 详情 | [并排图](native/final-390-mist-detail-pair.png) | [并排图](native/final-390-paper-detail-pair.png) |
| 我的 | [并排图](native/final-390-mist-mine-pair.png) | [并排图](native/final-390-paper-mine-pair.png) |

五页总览：[薄雾绿](native/final-390-mist-overview.png)、[暖纸白](native/final-390-paper-overview.png)。原生图保留微信顶部、原生Tab和设备安全区；对照按390逻辑像素宽归一，原始PNG和测量JSON一并保留，不能把开发者工具显示缩放当作逻辑尺寸。

## 验证

| 项目 | 证据与状态 |
| --- | --- |
| 自动测试 | 676项通过；覆盖时间线、详情打卡／忙时／撤销、目标调整与恢复、照片约束、上传重试、结果未知、迟到回执、账户切换、计划读回与草稿恢复 |
| 源码检查 | 通过；命令与最终结果见 validation.json |
| 云模块一致性 | 122个生成文件与源码一致；未改领域或服务端生成物 |
| OpenSpec | 26项变更严格校验通过；本变更为 `implement-fusion-native-ui` |
| 微信原生编译 | 23项WXML输入、23项WXSS输入通过真实 `wcc.exe` / `wcsc.exe` |
| 隔离原生模拟器 | 两主题×四宽度×五页，40张普通布局截图；另有长名、大字号夹具、输入聚焦和滚动证据。禁止云、普通网络、本机存储及业务写入 |
| 真实云端／真机／双账户 | 未执行本次独立验收；已有自动合同测试与隔离截图不能代替这些证据 |
| 用户UI验收 | 待用户在原生项目中确认视觉与交互 |

390px双主题共248个关键配对矩形均≤2px，最大1.90625px；完整差异、配对边界和覆盖见 [ACCEPTANCE.md](ACCEPTANCE.md) 与 [acceptance-summary.json](acceptance-summary.json)。真实鼠标点击已触发onFocus；桌面keyboardOpen=false，手机软键盘和系统字号待真机验证。大字号夹具模拟fontSizeSetting=20。

## 平台与真实业务差异

- 微信原生顶部、Tab形状与高度、系统字形和安全区按平台显示。安全区可能使页面末尾增加34px留白，不改变正文控件的位置。
- 主页面标题与习惯名称24px，带返回行的子页标题按冻结原型为22px；正文15px，待做任务16px，完成任务14px。
- 原型的演示备注、内存保存、无样例历史及入口预览文案未进入正式逻辑。正式历史显示实际安排，照片和历史明细通过真实入口操作。
- 暖纸白按已有主题保留配色，只与薄雾绿共享布局；不存在暖纸白的冻结原型，其颜色验收针对主题参数。

本地验收时尚未提交、推送、部署、合并、发布或迁移数据；后续 Git 状态以仓库记录为准。原有 `PRODUCT.md` 和设计资料均保留，其中七个基准来源文件用于复核并随实现保存。
