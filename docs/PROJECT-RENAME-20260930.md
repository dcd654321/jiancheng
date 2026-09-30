# 工程目录命名

日期：2026-09-30。产品：渐成习惯打卡。分支：`dev`。

## 路径映射

| 用途 | 原目录 | 当前目录 |
| --- | --- | --- |
| 活动工程 | `D:\codex\coding\yidian-miniprogram` | `D:\codex\coding\jiancheng-miniprogram` |
| 本地检查点 | `D:\codex\coding\yidian-recovery` | `D:\codex\coding\jiancheng-recovery` |

工程包名为 `jiancheng-miniprogram`，微信工程名为“渐成习惯打卡”，Git 远端为 `https://github.com/dcd654321/jiancheng.git`，云资源使用 `jiancheng_daka_` 前缀。

工程 README、导入命令、部署目录及检查点引用统一使用当前路径；灵感拾光簿中引用本工程的三份文档同步更新。历史文档中的目录引用按当前路径解析，原事件日期、资源名称和验证结果保留。

## 历史数据与检查点

检查点根目录改名，内部 37 个检查点目录保留，5 份原始 `manifest.json` 的 SHA-256 在改名前后相同。归档文件及清单中的旧绝对路径记录创建时的位置，查找时按上表替换根目录。

`tests/legacy/` 及相关回归测试中的旧存储键、导出文件名保留，用于验证历史数据不会被活动客户端误读、修改或删除。历史云迁移记录中的旧集合与函数名称保留。

## 使用与回滚

微信开发者工具导入 `D:\codex\coding\jiancheng-miniprogram`，工程根目录下包含 `project.config.json`。旧的最近项目入口需要重新选择此目录。

回滚目录改名时，先关闭占用工程目录的进程，将两个根目录改回上表原目录，并恢复本次文档路径修改；无需修改依赖、AppID 或云资源。

## 验证

从新工程目录执行以下检查：

- `npm test`：277/277 通过。
- `npm run check`：291 项语法、配置与页面结构检查通过。
- `npm run check:cloud`：61 份云模块产物与源码一致。
- `npm run openspec -- validate --all --strict`：12/12 通过。
- 灵感拾光簿同步修改引用后执行 `npm test`：380/380 通过。
- 活动客户端、服务端、构建脚本及五个业务云函数源码未检出 `yidian`；受版本管理的工程文档中，旧目录引用仅出现在本文的迁移映射中。本机工具对历史会话记录的引用保留原始位置。

微信开发者工具重新导入、WXML/WXSS 编译与真机运行未在本次验证。本次改动保留在本地工作区，未提交、推送或部署。
