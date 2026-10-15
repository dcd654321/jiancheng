# 启动体验优化（2026-10-15）

本轮调整渐成今日页的启动展示与读取等待。进入后 0.5 秒内显示页面框架是验收目标，实际耗时待原生模拟器和真机记录。

## 页面与读取

| 条件 | 页面行为 |
| --- | --- |
| 冷启动，尚无可信账户内容 | 先显示今日页框架及两张纯形状骨架，不生成习惯名称、数量、进度或完成状态 |
| 读取持续不足 300 ms | 不显示等待文字 |
| 读取达到 300 ms | 显示“正在读取今日习惯” |
| 读取达到 3 秒 | 显示“连接有些慢，正在读取今日习惯” |
| 共享初始化与账户读取总计达到 8 秒 | 结束本次逻辑等待，提供重试；旧请求迟到结果不能覆盖新尝试 |
| 同一可信会话热返回 | 保留最近合法确认内容，并按现有新鲜度规则刷新 |
| 账户会话失效或变化 | 清除旧投影，恢复骨架，拒绝旧会话响应 |
| 可信页面内容完成渲染 | 按业务条件触发外观远端读取和运营监控上报，合并重复触发；同步状态、外观与分享入口也具备对应回调 |

共享初始化与纯账户读取共用一个 8 秒总预算，替代上一轮分别 15 秒的设置。成功、失败、超时和离页时取消或使旧等待提示失效。底层物理请求可能继续执行，客户端通过读取尝试和会话标识隔离迟到结果。

数据、受信身份、账户 epoch、版本冲突、operationId 和写入待核对协议保持不变。账户内容继续仅存于可信会话内存，不新增本机快照或离线队列，不拆分云接口。本轮仅本地实施，不含部署、发布或提交。

## 验证记录

| 项目 | 状态 |
| --- | --- |
| OpenSpec 提案、设计、规范与任务更新 | 已完成 |
| 框架、两张骨架和真实空态切换 | 本地页面回归通过；真实空态须等待合法账户确认 |
| 300 ms / 3 秒提示及定时器清理 | 假时钟验证阈值、快速完成、失败、离页、重入和重试；旧回调不更新新访问 |
| 8 秒总预算、重试与迟到隔离 | 初始化耗时 6 秒后读取仅余 2 秒；超时释放 busy，旧初始化不补发过期请求，旧回执不更新新快照；并发读取合并 |
| 同会话热返回、账户变化与可选服务调度 | 实际会话模块与适配层的隔离集成回归通过；页面渲染回调前不发附加请求，旧页面回调失效，热刷新内容保留 |
| npm test | 640/640 通过，0 skip |
| npm run check | 525 项通过 |
| npm run check:cloud | 122 个产物与源码一致 |
| npm run openspec -- validate --all --strict | 24 项通过 |
| 微信原生 wcc / wcsc | WXML 20 个、WXSS 19 个输入通过 |
| git diff --check | 通过；已有 reminder WXSS 的换行转换提示不影响差异检查 |
| 原生模拟器视觉 | 两套主题的骨架、慢提示、超时、重试成功、热返回共 10 态通过；390px 视口两张骨架卡均高 110px，底部占位不溢出，页面栈与元素检查通过，异常为空 |
| 0.5 秒框架显示目标 | 未做有效端到端计时；自动化截图采集时间不作为首帧速度 |
| 真机框架、账户读取和数据可操作耗时 | 待验证 |

本轮不修改服务端代码。涉及客户端读取预算、会话适配层、页面提示和渲染后附加请求调度，需要重新上传客户端后才能在手机验证。原有工作区修改保留，未提交、上传、部署或发布。

主要文件：`miniprogram/services/cloud-session.js`、`cloud-transport.js`、`workspace-store.js`、`app-lifecycle.js`、`ui.js`，以及今日页、云端状态页、外观页和分享页的渲染回调。

隔离模拟器脚本：`qa/startup-experience-20261015.cjs`；页面状态、截图与调用计数见 [evidence.json](audits/2026-10-15-startup-experience/evidence.json)。夹具仅在内存返回合成账户，真实云请求、网络请求、业务写入及本机存储读写均为 0。手机真实云耗时与正式版本是否已部署另行核验。

| 主题 | 骨架 | 慢连接 | 超时 | 重试成功 | 切回并更新 |
| --- | --- | --- | --- | --- | --- |
| 薄雾绿 | [截图](audits/2026-10-15-startup-experience/mist-skeleton.png) | [截图](audits/2026-10-15-startup-experience/mist-slow.png) | [截图](audits/2026-10-15-startup-experience/mist-timeout.png) | [截图](audits/2026-10-15-startup-experience/mist-retry-ready.png) | [截图](audits/2026-10-15-startup-experience/mist-warm-return.png) |
| 暖纸白 | [截图](audits/2026-10-15-startup-experience/paper-skeleton.png) | [截图](audits/2026-10-15-startup-experience/paper-slow.png) | [截图](audits/2026-10-15-startup-experience/paper-timeout.png) | [截图](audits/2026-10-15-startup-experience/paper-retry-ready.png) | [截图](audits/2026-10-15-startup-experience/paper-warm-return.png) |

对应规范：[repair-delete-and-reduce-wait](../openspec/changes/repair-delete-and-reduce-wait/proposal.md)。
