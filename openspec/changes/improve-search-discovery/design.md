# Design

## Context

见 proposal.md 的目标。现有四模板集中在 habit-templates.js，edit 支持 template 参数；app 启动立即 start 账户会话，公开页需要延迟该过程。共享 monitorApi 的渐成事件与 payload 为固定白名单；本应用服务端已有 monitor_events 写入、幂等事件标识、账户 epoch 和删除栅栏。

## Goals / Non-Goals

**Goals:** 复用既有创建流程，公开读取独立于云账户，来源只使用有限枚举，统计失败不影响业务。

**Non-Goals:** 不提供用户内容索引，不改共享监控接口与管理端，不引入统计 SDK、离线业务队列、新集合或登录要求。

## Decisions

1. 公开路由使用 pages/discover/index 与 pages/template/index?key=read|walk|study|tidy，静态配置复用既有模板值。未知参数不回显；公开页不使用绑定账户数据的页面包装器，仅订阅已存在主题，默认主题可直接渲染。复用本地合法分享封面。介绍页从“我的”进入，公开内容链接使用 navigator。
2. sitemap 允许无参数介绍页和精确 key 参数模板页，之后 disallow *。规则不能约束参数值，页面自身严格校验四个模板键，canonical 分享只产生合法路径。不使用 sitemap 代替账户权限。
3. app 接收 onLaunch/onShow 参数。公共入口只建立内存服务对象，延迟 prepare/start/onForeground；私有页面生命周期调用幂等 ensureAccountReady 恢复原账户流程。内部公开导航也不能触发账户读。
4. 内存归因对象提供 viewPage({route, templateKey})、chooseTemplate(key)，冷启动首次 onShow 去重，热重入更新来源；scene 1129 禁止遥测，场景、路由、模板键均归一化，不采集 query/referrer。名称搜索进入默认今日首页时只记录固定 pages/today/index 枚举；其他未知私有路由不记录原始路径。每次合法入口最多记录一次 discovery_entry。待发事件数量有限，无本机持久化；账户上下文变更和删除使旧事件失效。
5. 在本应用业务 API 增加 trackDiscovery，复用现有 reporter 写 monitor_events，不改共享 monitorApi。客户端仅在 pull 响应声明归因 capability 后启用新 action 和 mutation searchSource 字段；旧云版本继续现有协议。服务端校验 epoch、字段白名单、事件标识、受信身份及账户删除状态，公开浏览与模板选择事件幂等。搜索来源附于服务端真实确认的 habit_created/checkin_completed，可按 session/visit 关联，不信任客户端自报成功。统计事件不进入账户 state，不产生新的持久账户来源。

## Risks / Trade-offs

- 新访客只读公开页没有账户 → 不主动创建账户；纯匿名访问量由微信后台提供，进入账户后尽力补齐当前内存中的浏览和选择。
- 新旧客户端与云版本不一致 → capability 协商关闭新协议，公开内容不受影响；发布顺序先业务云函数后客户端。
- 热重入、账户切换和重试可能串来源 → 固定每次操作的来源快照，并用 generation/epoch 与已有删除事务栅栏隔离。
- 收录不一定发生 → 本地只验证可达性和配置，后台收录与真实搜索单独验收。

## Migration Plan

本轮仅本地代码与生成副本，不执行部署。后续授权部署时，精确目标为 jiancheng_daka_api 及客户端，无数据库迁移或数据删除；保留原业务协议。回滚客户端改动与归因服务端代码可停止新增遥测，原有事件保留，账户数据不转换。不得自动处理旧设备本机数据。共享资源配置、发布、Git 合并均另行授权。
