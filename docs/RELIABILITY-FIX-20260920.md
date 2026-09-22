# B019：评审问题修复与验证

日期：2026-09-20。工程：`D:\codex\coding\yidian-miniprogram`。

## 已修复的范围

本轮对应[修复前评审](audits/20260920-ux/REVIEW.md)的批次A（R1—R4）。保留原生小程序、三Tab、白底深绿与云端主数据，不重新设计整体页面。

| 问题 | 修复结果 |
| --- | --- |
| 首次云读取失败后“重新读取”不发请求 | 无engine时重新初始化，复用已保存的同意状态，不需要清缓存 |
| 未保存备注被刷新覆盖 | 会话草稿按账户/代际/习惯/日期隔离；刷新、切页、返回保留；保存落盘成功后才清理对应草稿 |
| 首页无同步提示、离线仍显示已同步 | 会话状态通知当前可见页面；异常入口按需显示；离线、错误、待同步和冲突优先于成功状态 |
| 留在页面时网络恢复不重试 | 单个监听器协调恢复；300ms去抖、恢复启动间隔至少1.5秒，等待在途请求，重用原操作ID，无循环轮询 |

同步时间另改为标明北京时间的`YYYY-MM-DD HH:mm`。备注草稿不自动上传、不保存到设备存储，结束应用进程后不保证保留，界面明确提示保存；跨日旧草稿可见但禁止提交到今天。切换到新账户/数据代际后不会继续展示旧备注。

## 自动化验证

新增`tests/reliability.test.cjs`：先运行8项失败测试，再修复并扩展至15项，全部通过。覆盖首次失败重试、草稿隐藏/重开/保存失败/后续输入/跨日/切换账户、通知解除订阅、离线状态与时间、慢pull期间入队、操作ID复用、网络事件频发/在途失败/无循环，以及已有表单输入和验证错误不被刷新清空。

两项已有断言按新增合法异步行为调整，未删除保护条件：

- `workspace.test.cjs`先等待独立的当日记录自动提交尝试结束，再确认有待同步时管理操作不额外联网。
- `startup-pages.test.cjs`计入新增状态通知；旧onShow周期不能追加刷新，隐藏/卸载页面也不接收更新。

最终门禁：174项测试通过，0失败、0跳过；105项结构/语法/页面检查；5个共享云模块与源码一致；微信原生编译10个WXML输入产物101069字节，全部WXSS通过。这些门禁不等于真实弱网或正式上线验收。

## 真实模拟器验证

使用微信开发者工具自带CLI，实际视口363×785；所有4张截图已逐张查看。

1. 正常冷启动：`ready=true`、`phase=ready`、`pending=0`、1个现有测试习惯；首页无需手动刷新。
2. 在原有“上线验收阅读”详情输入固定验收草稿，调用刷新、返回首页、重新进入：文本保持，`noteDirty=true`，`pending=0`，云确认业务state完全未变。截图：[草稿](evidence-b019-20260920/detail-draft.png)。
3. 将输入改回原保存值，验收草稿清除，没有调用保存、创建或删除操作。
4. 调用会话`setNetworkAvailable(false)`注入离线状态，页面自动显示提示。截图：[首页离线状态](evidence-b019-20260920/today-offline-injected.png)、[同步页离线状态](evidence-b019-20260920/sync-offline-injected.png)。这不是关闭系统网络，不能冒充真实断网测试。
5. 恢复状态后通过`recoverConnection()`真实读取云端，同步页自动变为“数据已同步”，显示北京时间。截图：[真实读取后](evidence-b019-20260920/sync-ready.png)。
6. 业务state与检查开始前逐字比较相等；移除仅用于本次检查的运行时属性，回到首页。未清除同步缓存、未迁移旧本机数据、未提交云端业务写入。

## 修改清单与回滚

原件检查点（18个文件，修改前逐一SHA-256验证）：

`D:\codex\coding\yidian-recovery\20260920-B019-before-reliability\project`

修改的原文件：

- `miniprogram/app.js`
- `miniprogram/services/app-lifecycle.js`、`cloud-session.js`、`sync-engine.js`、`workspace-store.js`、`ui.js`
- `miniprogram/pages/detail/index.js`、`index.wxml`
- `miniprogram/pages/sync/index.js`、`index.wxml`
- `miniprogram/pages/today/index.wxml`
- `tests/startup-pages.test.cjs`、`tests/workspace.test.cjs`
- `README.md`、`docs/BACKLOG.md`、`docs/CLOUD-SYNC.md`、`docs/VERIFICATION.md`、`docs/CHANGELOG-RELEASE-PREP.md`

新增文件：`miniprogram/services/note-drafts.js`、`network-recovery.js`、`sync-presentation.js`，`tests/reliability.test.cjs`，本记录及`docs/evidence-b019-20260920/`中的4张PNG。

修复后检查点（27个文件，逐一SHA-256核验）：

`D:\codex\coding\yidian-recovery\20260920-B019-reliability-verified\project`

检查点父目录的`manifest.json`记录每个文件相对路径、修改前哈希（新增为null）、修复后哈希及字节数。回滚只处理此清单，先确认当前文件哈希仍匹配修复后版本；如已有后续修改，另存后再人工合并，不覆盖用户新工作。

确认需要回滚后，将18个原文件按相对路径复制回来。新增三个服务模块可保留，它们不会被原版本引用；新增回归测试应移到工程外留档，避免针对新API的测试在旧版本报错。新文档和截图保留为历史记录，无需删除。最后重新编译并运行原版本门禁。

本轮没有云部署、环境变量、权限、AppID、云开关、AI、数据库结构或业务数据更改，所以无需回退云端。文件回滚不会删除云端习惯，也不能代替云数据备份。

## 仍未完成

- 物理断网/弱网、真机前后台恢复、系统回收进程、iOS/Android键盘与大字号、双账户/双设备冲突、跨日真实联调。
- 真实云备注保存、编辑、导出、删除与竞争场景的完整验收。
- 评审批次B/C：创建表单与星期布局、首页权重、数据菜单分组、详情历史和统计层级；本次未修改这些流程。
- 发布所需限流、费用保护、隐私、备案、审核和真实AI接入。

当前结论是“批次A代码修复完成、基础模拟器验证通过”，不是“可正式上线”。
