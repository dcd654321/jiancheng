# B018：测试云启用与冷启动页面修复

日期：2026-09-20。用户明确要求处理云连接开关、页面加载刷新，并验证实际保存与恢复。

## 结论

开发者工具已运行真实测试云基础流程：首次账户读取/建档、页面创建习惯、打卡自动提交、移除确认缓存后重启恢复、进度统计。客户端现在启用测试云；这不是正式发布完成声明。

## 原因与修改

1. `miniprogram/config/cloud.js` 的 `enabled:false` 使启动在客户端直接失败。改为测试环境 `enabled:true`，不修改云权限、服务端身份校验或AI开关。
2. 页面 `onShow` 早于网络返回时只显示加载状态，未等待 `app.dataReady`。`services/ui.js` 的共享生命周期现在在成功/失败结束后刷新；可见性与显示代次检查阻止迟到结果更新已隐藏、卸载或重新显示的旧页面。
3. 数据同步页复用该生命周期，但不启动无用的跨日定时器。
4. 原配置测试要求关闭开关，页面测试多在数据就绪后运行或手动刷新，未覆盖真实冷启动。更新配置断言，新增 `tests/startup-pages.test.cjs`，使用实际配置、实际会话/工作区/页面代码和延迟的内存传输。

本次启用仅用于开发者受控测试。旧计划Task 8中“全部双账户验收后再启用测试前端”的顺序由本记录替代；双账户、真机、安全与隐私仍是公开发布门槛，不用关闭开发客户端来代替服务端保护。

## 本地验证

- 修改实现前：配置与新启动测试共8项失败。
- 修改后：159项测试全部通过，0失败/跳过；100项语法/配置/页面检查通过；5个云共享模块与源码一致。
- 新增7项启动回归：今日/进度/我的/数据同步的延迟冷启动，失败显示错误，隐藏/卸载不更新，旧显示回调不干扰新显示。
- 微信原生编译：10个WXML输入，99902字节；app及全部页面WXSS通过。
- 本次无云函数源码修改或新部署，不重复此前已通过的Node 16云包检查。
- 全套测试初次运行发现同步页新增跨日定时器会让原同步页测试不退出，已将该页设为 `watchDate:false`，停止该次测试后完整重跑通过。

## 开发者工具真实云验证

目标：`wx58e61dffcbfa4249` / `cloud1-d4gq76oyt363f08a7` / `habitApi`。

1. 最终入口部署任务 `cc2821e1-3e79-4a96-920c-fa0a7164a304` 已返回 success/execution_success，1文件、950 B。未知动作探针返回 `INVALID_REQUEST / 不支持的请求`，无临时diagnostic字段。
2. 启用前：已同意说明，但 configured=false、ready=false，首页报“云环境尚未配置”。启用并重编译后：configured=true、ready=true、pending=0、lastError为空，首页自动 dataReady=true、loading=false，云账户习惯数0。首次pull可能创建账户文档，不记作只读操作。
3. 通过真实创建页 `onInput` / `onSave` 创建唯一合成习惯“上线验收阅读”（每天5分钟，无备注）；云端确认后自动返回今日，pending=0。
4. 通过今日页 `onComplete` 打卡；页面先显示1/1、pending=1，后台提交后pending=0。独立调用真实云函数pull确认 revision=2、1个习惯、1条status=standard记录。
5. 缓存恢复：仅在无busy/pending/conflict、缓存仅含上述合成习惯时操作。把当前账户确认缓存完整备份至本小程序临时键 `yidian.acceptance.B018.confirmed-cache`，读回校验后移除该账户的单个同步缓存键。未清空小程序全部存储，保留同意、账户绑定和全部旧本机记录；云数据未删除。
6. 重启模拟器后未手动刷新页面，首页自动 ready=true、loading=false、total=1、done=1；确认缓存重建。逐字段核对账户、epoch、revision和业务state均与备份相同。整个响应对象不相等是因为写入响应额外含operationId/appliedRevision/replayed，读取响应不含这些回执字段，不是业务记录变化。
7. 恢复确认后仅移除本次生成的临时备份键；重建的正式缓存保留。云端合成习惯和完成记录仍保留，方便用户直接查看，不执行purge。
8. 进度页实际控制器：dataReady=true、loading=false、error为空、stats.done=1。
9. 客户端直接读取 `yidian_accounts` 仍被拒绝，错误码 -502003（Permission denied）；没有开放数据库规则。

页面验证通过微信开发者工具自动化接口运行真实页面控制器及云调用，不是setData伪造业务结果。Windows Computer Use截图通道本次提示app approval timed out，未完成新的截图视觉验收；不能把控制器状态或原生编译当作真机视觉验收。

## 变更范围与回滚

修改前检查点：`D:\codex\coding\yidian-recovery\20260920-B018-before-startup-fix\project`，10个原文件复制后逐一核对SHA-256。

原文件：`miniprogram/config/cloud.js`、`miniprogram/services/ui.js`、`miniprogram/pages/sync/index.js`、`tests/pages.test.cjs`、README及BACKLOG/CLOUD-SYNC/VERIFICATION/CHANGELOG-RELEASE-PREP/CLOUD-ENTRY-VERIFICATION-20260920六份文档。

新增：本记录、`tests/startup-pages.test.cjs`。需要回退时恢复检查点中的上述文件，单独移走这两个新增文件，并重新编译。不要覆盖其他后续改动；回退旧配置会再次关闭前端测试云连接。

完成后检查点：`D:\codex\coding\yidian-recovery\20260920-B018-startup-cloud-verified\project`，包含上述12个文件，逐一核对SHA-256；可用于恢复本轮已验证版本。

文件回滚不会删除已创建的合成云数据，不会回退服务端变量；本次没有修改服务端变量、云权限或部署代码。无需为了回滚执行“清除全部数据”，以免影响原有本机记录。记录不保存AppSecret、OPENID、账户摘要值或私人备注。

## 仍未完成

双账户/双设备隔离、真实弱网/响应丢失、跨日、真实编辑/备注/导出/purge、真机视觉与交互、SDK风险处置、限流预算、隐私与平台审核。AI仍为本机规则建议。这些事项不再阻止开发者测试基础流程，但完成前不能宣称正式上线就绪。
