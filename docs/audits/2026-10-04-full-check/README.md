# 2026-10-04 全量复核证据

[完整报告](../../FULL-CHECK-20261004.md)。当前 dev 工作区；没有部署或发布。

| 文件 | 内容 |
| --- | --- |
| `tests-before.log` | 修复前基线：390 项通过 |
| `tests.log` | 修复后全量：412 通过，0 失败，0 跳过 |
| `check.log` | 341 项语法、配置、页面检查通过 |
| `cloud.log` | 61 个云生成文件匹配 |
| `openspec.log` | 16 项规范严格校验通过 |
| `native.log` | 16 WXML、16 WXSS 微信原生编译通过 |
| `render.log` | 全路由受控渲染完成，恢复探针 `fixturePresent=false` |
| `diff.log` | Git 差异空白检查通过；保留既有 LF/CRLF 提示 |
| `routes.json` | 21 个路由/主题观察及非法详情链接出口断言；不含真实账户或生产数据 |

截图均为 F 内存夹具，已逐张打开检查。所有 14 页有 `*-mist-F.png`；今日、进度、我的、编辑、详情、外观、AI 助手另有 `*-paper-F.png`。分享和提醒显示当前关闭状态。截图和日志遵循仓库忽略规则；JSON 与说明可追踪。

复现：微信工具自动化实例就绪后运行 `node qa/full-check-20261004.cjs`，默认端口 9433，环境变量 `MP_AUTO_PORT` 可覆盖。依赖沿用 `%TEMP%/mp-automator`。脚本不执行云写入、实际模型调用、提醒授权或分享创建；finally 恢复原应用引用，回到今日页并输出夹具恢复探针。

回归测试 `tests/page-startup-boundaries.test.cjs` 验证四页的冷启动、核心失败、隐藏/销毁与旧访问回调；`tests/all-page-contracts.test.cjs` 检查真实注册页面和导入模板的方法绑定，并断言打开页面无写入或模型请求。F 和本地测试不证明真实云端、双账户、真机输入、弱网或模型效果。
