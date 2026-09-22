# OpenSpec 使用说明

项目在 `dev` 分支使用 OpenSpec 1.13.1，版本锁定于根目录 `package.json` 与 `package-lock.json`。安装产生的规划文件位于 `openspec/`，Codex 的六个工作流技能位于 `.agents/skills/`。它们只用于开发过程，不进入小程序或云函数运行包。

## 本机运行

需要 Node.js >=20.19.0。在已有合适 Node 的终端中：

```powershell
npm ci
npm run openspec -- list
npm run openspec -- validate --all --strict
```

本机默认 `node` 曾是 12.x。若仍未升级，可用 Codex 附带的 Node 执行本项目脚本，不修改系统 PATH：

```powershell
& 'C:\Users\dcd\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' scripts/openspec.cjs list
& 'C:\Users\dcd\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' scripts/openspec.cjs validate --all --strict
```

依赖尚未安装时需先在受支持的 Node 环境运行 `npm ci`。如首次启动 Codex 时看不到仓库内技能，可重新打开项目任务，让技能目录被重新发现。

## 一次变更的流程

1. 在 `dev` 上确认工作区状态，更新远端 `dev`，保留用户已有修改。
2. 用 `$openspec-propose` 形成 proposal、specs、design、tasks；先审阅需求、范围和验收条件。
3. 用户要求实施后，用 `$openspec-apply-change` 按任务修改代码并逐项验证。远端部署、数据迁移和共用资源修改按实际目标另行核对授权。
4. 测试与用户验收各自留结果；完成后可归档规范。归档不会合并代码。
5. 只有用户测试确认并明确要求时，才将 `dev` 合并到 `main`。

可用技能：`openspec-explore`、`openspec-propose`、`openspec-update-change`、`openspec-apply-change`、`openspec-sync-specs`、`openspec-archive-change`。CLI 的状态命令为 `npm run openspec -- status --change <change-name>`。

当前首个变更是 [`connect-shared-production-cloud`](../openspec/changes/connect-shared-production-cloud/proposal.md)：共享正式云环境接入。它目前只是待实施提案，`tasks.md` 的复选框均未完成。现有主规范为空是初始化状态，后续能力在验收后再同步，不把当前代码未经核验的行为写成正式规范。

## 本次初始化记录

- 2026-09-23：在 `dev` 加入锁定的 OpenSpec 开发依赖、项目规则、六个 Codex 技能及第一份提案。
- 校验：`validate --all --strict` 对该变更 1 项通过、0 项失败；结构检查 118 项通过；云模块一致性检查 5 项通过。
- 初始化提交时，业务测试在当前工作区为 193/194 通过。唯一失败是旧资源命名测试要求 `cloudfunctions/habitApi` 路径不存在，而微信开发者工具在本机重新生成了这个被 Git 忽略的空目录。该目录不是本次初始化创建的，也不在提交中。后续将断言调整为检查旧函数是否仍有可部署入口或包文件；空目录不再触发误报。原生微信工具和真机验收未在本次初始化中执行。
- 回退：先确认没有依赖这些规范的后续变更，再在 `dev` 对初始化提交执行 `git revert <commit>`。该操作只回退仓库文件，不会改变云端资源或数据。

项目开发约定见根目录 [`AGENTS.md`](../AGENTS.md)。

## 后续本地验证优化（2026-09-23）

`tests/cloud-resources.test.cjs` 现在检查旧 `habitApi` 是否仍有可部署的 `index.js` 或 `package.json`，不要求本机空目录不存在。该断言仍能阻止旧函数代码重新进入工程，同时容忍微信开发者工具创建目录。验证结果：业务测试 194/194、结构检查 118 项、云模块一致性检查 5 项、OpenSpec 严格校验 1/1，均通过。此次只改测试断言和本文记录；如需回退，可在 `dev` 撤销对应提交。
