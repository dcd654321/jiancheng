# 2026-10-03 AI 复核证据

[复核报告](../../AI-SELF-REVIEW-20261003.md)。当前 dev 工作区，没有部署或发布。

- `tests.log`：390 项通过，0 失败，0 跳过。
- `check.log`：338 项结构/语法/配置检查通过。
- `cloud.log`：61 云生成文件匹配。
- `openspec.log`：16 项严格校验通过。
- `native.log`：16 WXML、16 WXSS 原生编译通过。
- `observations.json`：16 组方向/时长、空星期滚动、确认页安排、账户恢复按钮的脱敏断言结果。
- `empty-weekdays-F.png`：空星期展开与定位，原生滚动返回成功，字段错误可见。
- `basis-confirm-F.png`：实际点击进入可编辑确认页，目标 5/2 分钟，周一/三/五，20:30。
- `account-recovery-F.png`：受控账户失效后显示读取入口，生成与采用暂停；随后实际 tap 恢复按钮，受控读取完成并要求重新同意。

三张最终截图已逐张检查。F 使用内存空状态和受控云会话/响应，不证明真实模型效果、线上保存、真实双账户或真机行为。所有注入与临时 API 包装在 finally 恢复，最后回到真实今日页并断言 `fixturePresent=false`。

复现：保持项目微信自动化实例就绪，端口 9433，运行 `node qa/ai-ui-20261002/recheck.cjs`；可通过 `MP_AUTO_PORT` 指定端口。依赖沿用 `%TEMP%/mp-automator`。脚本只执行基础方案、受控错误恢复及确认页导航，不点击保存或调用真实模型。PNG/log 遵循仓库忽略规则，JSON 与说明可以追踪。
