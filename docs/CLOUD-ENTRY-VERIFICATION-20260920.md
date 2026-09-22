# 云函数入口联调记录

更新：2026-09-20。环境：`cloud1-d4gq76oyt363f08a7`；函数：`habitApi`。

最终复核：`cc2821e1-3e79-4a96-920c-fa0a7164a304`已返回success/execution_success（1文件、950 B）。实际探针为`INVALID_REQUEST / 不支持的请求`，没有diagnostic字段，入口修复已生效。下文等待部署的表述是当时记录；后续客户端启用和真实业务验证见[STARTUP-FIX-20260920.md](STARTUP-FIX-20260920.md)。

## 已确认的问题

微信工具运行时授权任务现已返回`authorized:true`。此前云控制台测试未知动作返回`UNAUTHORIZED`；实际小程序调用同一动作返回`INVALID_REQUEST / 请求包含不支持的字段`，说明实际小程序身份已通过入口校验，失败发生在业务参数校验阶段。

[CloudBase官方调用文档](https://docs.cloudbase.net/cloud-function/how-use)说明小程序调用会附带`event.userInfo`。第一次只忽略该字段后，云端仍拒绝请求。随后部署了仅在身份校验通过且未知动作被拒绝时返回字段名的临时诊断；2026-09-20实际返回`keys: ["action", "tcbContext"]`，没有读取字段值或返回用户标识。

由此确认本次实际调用除业务参数外还带有`userInfo`、`tcbContext`。两者属于入口需要剔除的元数据，不参与业务字段校验、账户归属或幂等指纹。身份继续只取`cloud.getWXContext()`。

## 修复与验证

- `cloudfunctions/habitApi/index.js`只忽略这两个元数据字段；其他额外字段、数组、非法对象仍交由原协议拒绝。输入对象不被修改。
- `tests/cloud-entry.test.cjs`直接加载实际入口，模拟SDK上下文和事务仓库；验证元数据兼容、身份伪造拒绝、未知字段拒绝、元数据变化后的幂等重放和停用开关。
- 加入`tcbContext`回归用例后旧实现3项失败；最终本地实现152项测试通过，99项结构检查通过，5个云共享模块一致，Node 16的6个云包文件语法、SDK加载及UUID能力通过。
- Windows现有旧版`npx`不兼容先前记录的`-y`命令组合；使用`npx --package=node@16.13.2 --call 'node scripts/check-node16.cjs'`完成兼容检查。
- 本地已移除临时诊断。最终入口增量部署任务：`confirmation_cloud_fn_inc_deploy_cc2821e1-3e79-4a96-920c-fa0a7164a304`；提交时等待微信工具确认，完成结果仍需复查。
- 客户端`enabled:false`保持不变；本记录尚不包含真实账户的业务读写闭环。
- 2026-09-20部署等待期间只读复核`yidian_accounts`：`total: 0`、返回0条。本次尚未执行`pull`、`mutate`或`purge`。

## 部署审计

- 首次仅忽略`userInfo`：任务`28c35e40-c248-4bb1-8b24-5031fea2c852`成功，1个文件、930 B；真实调用仍被字段校验拒绝。
- 临时字段名诊断：任务`4f12f8e1-ae2d-41b4-ad7e-c781d0586e10`成功，1个文件、1.0 KB。
- 最终移除两项元数据和诊断：以上`cc2821e1`任务待复核；必须看到无诊断字段的实际云响应，才能认定云端诊断已移除。

## 回滚

修复前6个原文件的校验副本在`D:\codex\coding\yidian-recovery\20260919-B017-before-entry-metadata\project`。恢复其中的入口文件并另行部署可回退云端代码；新增测试文件可单独移走，其他源码未改。

本地文件恢复不会撤销云端部署。需要停用测试函数时，将该环境的`HABIT_API_ENABLED`设置为`false`。已有`20260919-B016-T8-server-flags`检查点保留配置与文档历史。该记录不保存AppSecret、OPENID、原始身份元数据或习惯备注。

最终本地待部署检查点：`D:\codex\coding\yidian-recovery\20260920-B017-entry-final-local\project`，保存入口、回归测试及6份相关文档，共8个文件；复制后逐一核对SHA-256。当前微信工具已显示“MCP 客户端授权”弹窗，等待本次`habitApi`增量更新确认；未自动处理该授权窗口。
