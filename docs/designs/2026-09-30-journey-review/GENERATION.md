# 视觉稿制作与检查

工具：内置image_gen，非CLI。日期：2026-09-30。

原始参考：本轮审查的`01-current.png`和`08-today-FIXTURE.png`；先查看后作为参考图传入。原始生成文件保留于Codex generated_images；项目交付副本见本目录。

## A：轻松接上

交付：`direction-a-five-screens.png`，1727×911px。请求概念尺寸2200×1160，内部五屏按390×844比例描述；实际图片输出以文件像素为准。不可直接按生成图像素反推小程序单位。

最终生成提示词：

```text
Create a precise, elegant production-quality Chinese WeChat mini-program UI DESIGN PRESENTATION BOARD for 渐成习惯打卡. One consistent recommended design direction titled 轻松接上. This is a single design direction showing FIVE sequential screen states side by side, app content only. Overall canvas 2200x1160, each screen app content 390x844 at natural undistorted proportion with 28px gutters, board off-white background, top concise title and subtitles, screen labels above each screen, no decorative images. References are current product screenshots, use their existing pale green, white surfaces, forest green brand and restrained lime busy-goal chip. Redesign layouts as specified below, not exact cloning. No device bezel, OS status bar, clock, notch, battery, home indicator, browser chrome or device shadows. Reserve 44px top app navigation titled 渐成习惯打卡. Show text-only bottom tab strip 今日 / 进度 / 我的 for screen1,3,4,5. Use precise legible Chinese typography, system sans serif; title 26px/600, sections18px/600, body16px, secondary14px. Main ink #183B31, secondary #52665A, primary #245C44, page #F6F8F5, white surfaces, lime #DDF3A4 with dark #33511C text only for busy goal, divider#D8E2D9, rounded cards16px, button12px. Every action height48px. Strong spatial hierarchy, no excessive nested cards, no unnecessary shadows. No scores, trophies, streaks, ads, leaderboards, pop-ups or timers. Current date anchor 2026年9月30日 周三.
Screen 1 label 01 首次进入. Header 今日, subtle date. Hero 再忙，也能做一点. Description 选一个习惯，给忙碌的日子也留一小步。 Four template options in 2x2 grid 读一会儿 平时5分钟 忙时2分钟; 走路一会儿 平时10分钟 忙时3分钟; 复习一小段 平时5分钟 忙时2分钟; 整理桌面 平时3分钟 忙时1分钟. Below quiet outlined fullwidth 自己填写 and plain text 帮我定个小目标. Bottom tabs. Compact spacing so primary template choices immediately visible, no big illustration.
Screen2 label 02 确认计划. Header 确认这个小计划 with a text 返回 link. Subtext 创建后，做完再来记下。 Single clean summary surface with label 习惯名称 editable value 读一会儿; two stacked editable rows 平时目标 5 分钟 and 忙时目标 2 分钟. Schedule row 每天 with 修改; start 今天 · 9月30日. Quiet collapsed row 更多设置. A short textual summary 每天读5分钟，忙时读2分钟。 At bottom above safe inset a solid green large button 创建习惯, one short note 创建不会自动打卡。 All essential content fits one screen, no seven-day grid unless expanding custom schedule.
Screen3 label03 今日任务. 今日 and 9月30日 周三 at top, quiet 添加习惯. Compact progress text 今天已记录 0 / 1 with small progress line. Section 今天做这一件. Main standalone task 读一会儿; plain subtitle 计划21:30 · 时间只作参考. Two-column numbers 平时 5分钟, lime-tag 忙时 2分钟. Body instruction 做完后，点对应按钮记下。 Main fullwidth forest button 已读5分钟，记下; secondary fullwidth tinted busy button 已读2分钟，记下. Footer detail text 调整今天的目标. Leave calm space then bottom tabs. Buttons explicit complete action, no timer.
Screen4 label04 完成反馈. 今日 date and progress 今天已记录1 / 1. Large headline 今天这一小步，记下了. Completed task name 读一会儿, numeric 2分钟 and label 忙时完成. Main explanatory text 按忙时目标完成，原计划仍是5分钟。 Small text 已同步 (this is a mock state, don't add technical details). Persistent outlined button 撤销这次记录; another text action 查看记录. Below separated simple section 下次安排 明天 · 读一会儿, 平时5分钟，忙时2分钟。 No celebratory confetti or push/share solicitation. Bottom tabs.
Screen5 label05 再次进入. 今日 date and soft welcome 从今天接上就好. Subtext 过去不用补，今天做一点就好。 Task card 读一会儿 with 平时5分钟 / 忙时2分钟. Same main button 已读5分钟，记下 and secondary 已读2分钟，记下. Top welcome is short text, not extra duplicated action card. Bottom contextual section 最近7天 留下4次记录; 原目标3次 · 忙时目标1次; quiet 查看进度. Bottom tabs. All numbers and terminology consistent. Bottom of board short note 设计示意 · 非运行截图. Make extremely crisp readable typography and alignment, uncluttered yet real information.
```

## B：每日一页

交付：`direction-b-daily-page.png`，853×1844px；概念390×844比例。

最终生成提示词：

```text
Create a realistic production-quality Chinese WeChat mini-program UI concept, one single mobile app-owned content viewport 390x844, no device bezel, OS status bar, clock, notch, battery, home indicator, browser chrome, phone body or shadows. Product 渐成习惯打卡, an intentionally quiet habits tool with usual and busy-day smaller goals. Alternative art direction 每日一页. It should look materially different from the attached current green soft-card screenshot while supporting exactly the same task. Use ivory paper background #FAF7F0, ink #302B27, rust/cinnamon primary #854B31, deep muted blue secondary #3E6072, warm fine dividers #D8CFC2. Use elegant restrained Chinese serif headline only, system sans serif body, no handwriting, no paper texture, no illustrations, no motivational stickers, no gamification. Layout is an editorial daily page with a narrow left date marker and open list rows separated by horizontal rules, fewer enclosed rounded cards, square-soft 8px button corners. Top app nav 渐成习惯打卡. Big header 九月三十日 with small 周三 · 今日. Progress subtle 已记录 0 / 1. Generous breathing room but main task high in frame. Numbered habit entry 01 读一会儿, single-line 21:30 · 时间只作参考. Two neatly aligned goal columns 平时5分钟 and 忙时2分钟, the busy goal indicated by muted blue small label and text, not bright yellow. Instruction 做完后，点对应按钮记下. Strong fullwidth rust button 已读5分钟，记下, second outlined blue button 已读2分钟，记下. Quiet link 调整今天的目标. Below divider a single line 小一点，也值得记下。 Bottom actual tab labels 今日 / 进度 / 我的, use restrained library-style consistent outline icons or text only, don't crowd. Titles24px, habit18px semibold, body16px, help14px. Buttons48px, horizontal margins20px. The key distinction is a lightly ruled daily journal with editorial hierarchy and warm ink, not a color-swapped card UI. All displayed date context 2026-09-30, Wednesday. Ensure correct Chinese, high contrast, extremely polished alignment. App content only, no outside labels.
```

## 视觉检查与实施约束

- 已查看两份完整输出：A五个状态齐全、目标5/2与忙时反馈一致，B在排版结构和色彩上有明确区别。
- A用于推荐方向层级审阅，B用于偏好比较；它们不证明真实页面像素、无障碍尺寸或交互结果。
- 生成图出现的轻微渐变/纸面质感不纳入实施规范，使用报告中的纯色token。
- 生成图的标题/底栏仅是示意；真实小程序保留原生导航、胶囊、安全区和现有Tab资产，不照搬生成图的省略号或图标。
- 完成反馈是今日页状态，不能实现为强制跳出的新页面；再次进入示例数据仅为合成演示。
- 当前稿以一项任务展开为主，多任务紧凑模式、大字号和键盘的实施规格见报告第2、6节；未生成其像素级验证稿。
- 无新交互原型，没有执行真实用户偏好或任务实验。
