# 微信开发者工具验证（2026-09-30）

用于在微信开发者工具中渲染真实页面、采集双主题截图与恢复流程证据。所有操作只在本机进行；
除小程序自身的正常云读取（开发者登录账户，测试环境）外不写云端、不部署、不改配置。

## 环境

- 工具：微信开发者工具（安装于 `E:\weixinDevTool\微信web开发者工具`），基础库 3.17.3，模拟器 390×844。
- 自动化：`miniprogram-automator` 临时安装在 `%TEMP%\mp-automator`（未写入本仓库依赖）。

## 步骤

1. 启动带 automation 的工具实例（端口独占；若 9420 被其他项目占用改用其他端口）：

   ```bash
   cmd //c "E:\weixinDevTool\微信web开发者工具\cli.bat auto --project D:\codex\coding\jiancheng-miniprogram --auto-port 9431"
   ```

2. 采集证据（脚本自动连接 `ws://127.0.0.1:9431`）：

   ```bash
   node qa/devtools-20260930/capture.cjs
   node qa/devtools-20260930/capture-recovery.cjs
   ```

   截图输出到 `docs/audits/2026-09-30-journey-themes/`。

3. 辅助工具：`png-tool.cjs` 可解码/裁剪/放大/采样截图（纯 Node，无第三方依赖），用于核对
   渲染色值（例如页面底色 #F7F8F5 / #FAF8F3、主按钮 #486557 / #79604F 的逐像素比对）。
   `preview/chevron.html` 用于在浏览器中比对箭头 CSS 几何。

## 注入态说明（F 级）

`capture.cjs` 通过 `miniProgram.evaluate` 把 `getApp().store` 与
`getApp().appearanceController` 临时替换为测试夹具（内存内，退出即失效），
以便在不写入云端的前提下渲染“有待做任务 / 原位完成行 / 已调小目标 / 已保存旧完成记录”等状态。
页面模板、事件处理与渲染管线都是真实产物；标记为 `-inject` 的截图必须按 F 级证据使用。
