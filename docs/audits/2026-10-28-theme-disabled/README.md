# 主题保存按钮禁用排查

日期：2026-10-28。分支：dev，开始时与实时 origin/dev 一致。

## 已确认原因

当前源码在微信开发者工具连接共享测试环境 `cloud1-d8gopnalv908bb47a`。账户主会话已就绪，外观控制器的读取结果为 `loadState=unavailable`、`revision=null`、`loadError=服务尚未开放`。未取得合法主题版本时保存按钮保持禁用。

测试云 `jiancheng_daka_features` 状态为 Active。通过官方 CLI 下载的当前入口文件 SHA256 为 `9adb3fff713a09c8ef4f376b9bf34d0ee82a16c68aac4ebc29bb6a24d67b29d8`，与本地入口一致。该错误来自共同门禁，早于主题独立开关检查。以下条件至少一项不满足，当前 CLI info 不返回环境变量，因此尚不能确认具体缺少哪项：

- `HABIT_SIDECAR_CLEANUP_ENABLED` 必须为字符串 `true`。
- `HABIT_LIMITS_VERIFIED` 必须为字符串 `true`。
- `HABIT_IDENTITY_VERIFIED`、`HABIT_MINIPROGRAM_ONLY` 不得为字符串 `false`。

## 已完成的前端修正

- 未读取主题时显示正在读取或暂时无法保存，避免将默认主题误标为已保存的使用中主题。
- 云端拒绝时明确显示外观主题服务尚未开放；其他读取错误显示失败原因和重新读取入口。
- 保留预览、合法版本校验、离线限制及云端确认后才应用全局主题的行为。

## 验证

- `npm test`：677/677。
- `npm run check`：618 项。
- `npm run check:cloud`：122 个文件一致。
- `npm run openspec -- validate --all --strict`：26/26。
- `git diff --check`：通过。
- 回归测试覆盖读取中、服务拒绝、禁止发送保存请求，以及服务恢复后保留预览并完成一次模拟保存。
- 当前源码重新编译后，在微信模拟器打开真实外观页面、重新读取并预览 paper，确认按钮显示暂时无法保存，原因显示外观主题服务尚未开放。截图见 `service-unavailable.png`。

## 待授权的云端修复范围

用户后续选择隐藏换主题选项，当前不推进云端修复。客户端 `appearance.showEntry=false` 隐藏我的页入口，`enabled=true` 保留主题读取与已有显示。已调整对应页面回归检查，677项测试及上述静态/规范检查重新通过。重新编译后，微信模拟器我的页 `dataReady=true`、`appearanceEnabled=false`，实际菜单无外观主题入口；截图见 `mine-entry-hidden.png`。

目标限定为共享测试环境的 `jiancheng_daka_api` 与 `jiancheng_daka_features`。先读取并备份相关非敏感开关，核验账户清理对偏好和私有限流数据的覆盖、数据库权限与平台身份约束，再修正满足条件的缺失或错误配置。不得仅为接通主题而跳过核验或放宽门禁。若发现需要代码、数据库或部署变更，先形成对应 OpenSpec 变更并另行确认。

验收先只读确认 getAppearance 返回合法 theme/revision；真实保存验收需取得授权，再切换一次并恢复原主题。恢复原主题会产生新的合法偏好版本，不能撤销已产生的幂等收据及版本号。

本次未修改云端配置、部署云函数、保存真实账户主题、操作正式环境或执行真机验收；未提交、推送或合并。前端回滚仅需撤回 `miniprogram/pages/appearance/index.js` 与对应新增测试的本次差异，保留原有未提交文件。
