# 云SDK依赖检查（2026-09-15）

## 当前结论

本地云函数依赖已从wx-server-sdk 3.0.1升级并锁定到4.0.2，保留完整旧版检查点。`habitApi` 已部署到测试环境，2026-09-19已启用服务端环境变量，但前端云连接仍关闭。依赖告警尚未清零，不标记生产安全验收通过。

版本依据：[微信官方仓库及更新日志](https://github.com/wechat-miniprogram/wx-server-sdk)、npm官方注册表实时元数据。4.0.2为latest，4.0.3-beta.1为beta；未使用预览版本替代稳定版本。

## 本次审计

| 依赖版本 | low | moderate | high | critical | 依赖总数 |
| --- | ---: | ---: | ---: | ---: | ---: |
| wx-server-sdk 3.0.1 | 1 | 21 | 13 | 1 | 122 |
| wx-server-sdk 4.0.2 | 1 | 14 | 11 | 0 | 102 |

以上为2026-09-15再次指定npm官方注册表执行audit返回的metadata计数，不等于独立可利用漏洞数量；同一模块可对应多个公告。本机默认npmmirror不支持audit，已明确覆盖为官方注册表重查。没有执行audit fix、供应链覆盖或修改node_modules源码。npm官方元数据仍显示4.0.2为latest，4.0.3-beta.1仅为beta。

### 剩余依赖与本工程使用面

- `@cloudbase/node-sdk 3.17.2`固定依赖`axios 0.27.2`。审计涉及SSRF、原型污染利用链、请求/响应大小边界等。本工程目前不接收客户端URL、HTTP header或axios config；只调用SDK数据库接口。但不能仅据此认定上游全部风险不可达，部署前需验证固定服务端点与配置来源，并采用上游兼容修复。
- `@cloudbase/database 1.4.3`固定依赖`lodash.set 4.3.2`、`lodash.unset 4.5.2`。本地源码中调用位于realtime客户端；本工程只用事务doc.get/doc.set，不使用watch或用户传入字段路径。应继续确认服务器下发数据与扩展接口的信任边界，不用字段白名单替代完整依赖评估。
- 示例公告：[axios绝对URL风险](https://github.com/advisories/GHSA-jr5f-v2jv-69x6)、[lodash.set原型污染](https://github.com/advisories/GHSA-p6mc-m468-83gw)、[lodash.unset原型污染](https://github.com/advisories/GHSA-xxjr-mmjv-4gpg)。npm6提示旧审计端点将退役；后续可在固定的新npm运行时复核，不能因工具端点变化误报无告警。

## 已做验证

- 安装均使用`--ignore-scripts --no-audit --no-fund`，再单独只读审计；不执行上游安装脚本。
- `tests/sdk.test.cjs`加载已安装的真实微信SDK、真实数据库事务实现及EJSON序列化，只替换最底层数据库请求类；同时禁止HTTP/HTTPS/fetch回退，未使用任何云端凭据。
- 已验证缺失文档、嵌套payload往返、重复请求幂等、读写权限错误回滚、提交冲突重试及已提交结果返回。
- 使用与云端运行时一致的Node 16.13.2逐文件执行云包语法检查，并实际加载`wx-server-sdk 4.0.2`和`crypto.randomUUID`，均通过。该结果只证明加载与语法兼容，不证明有告警的传递依赖可安全上线。
- 此测试不覆盖真实腾讯云事务隔离、鉴权、网络、权限规则或费用。真实云环境联调仍是独立验收项。

## 部署前门槛

1. 处理或明确评估剩余告警，记录实际使用路径与补偿措施；不得仅因功能测试通过就忽略依赖风险。
2. 确认生产云函数Node运行时满足全部传递依赖要求；本地测试用Node24不证明云端运行时兼容。
3. 在测试环境验证仅服务端读写权限、可信APPID/OPENID、跨账户隔离、事务重试和离线队列。
4. 设置配额/限流/费用告警，避免免费环境误升级或无限调用。

## 回滚

旧版SDK及锁文件：`D:\codex\coding\yidian-recovery\20260915-B002-before-sdk-upgrade\project\cloudfunctions\habitApi`。回滚前先归档当前函数目录；按批恢复package.json、package-lock.json和node_modules。不要将旧版依赖回滚误认为安全修复。
