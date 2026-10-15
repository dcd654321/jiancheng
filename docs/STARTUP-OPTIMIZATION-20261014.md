# 首次启动优化

日期：2026-10-14。分支：dev。本地基线 3831a4d，与 origin/dev 一致；工作区既有监督、照片和监控修改保留。

## 启动链路

正式版仍连接共享正式环境。共享授权关系、cloudbase_auth、受信身份和账户持久化方式保持原协议。备婚待办使用资源方原生云调用，渐成需先完成共享实例鉴权；本轮没有真实耗时证据证明该阶段占全部等待。

| 环节 | 处理 | 可验证结果 |
| --- | --- | --- |
| App 初始化 | 核心会话配置有效后立即准备共享连接；外观和监控在工厂调用时加载 | 原生 init 在可选工厂之前发出，与其模块加载重叠；准备和核心请求共享同一个连接 |
| 首个 App onShow | 复用 onLaunch 的 dataReady，包括失败结果 | 一次启动只有一次 pull；原先首次失败后紧接着的第二次 pull 被移除；显式重试和后续前台恢复保留 |
| 今日模块 | 关闭的置顶、提醒、监督和照片服务不加载或构造；照片协调器到使用时加载 | 独立进程验证关闭时 4 个服务模块未装载；提醒可以在分享/置顶关闭时独立启用 |
| 云 API | 照片约束按实际 mutation/purge 调用加载，清理器按 cleanup 调用加载 | 普通已有账户一次账户 get，不加载下列 8 个模块；加载失败拒绝写入，清理失败继续 DELETE_PENDING |
| 等待恢复 | 共享 init 与纯 pull 各设 15000 ms 期限 | 超时释放 busy，可重新读取；旧请求物理上可能继续，但其迟到结果不能覆盖重试后的账户状态 |

普通 pull 延迟的云模块：media、supervision、media-worker、media-provider、supervision-repository、sidecar-cleanup、features-repository、limits。依赖仍包含在发布包中，按需加载减少初始化处理，不代表上传包缩小。

外观工厂异常时继续默认主题和核心读取。无效云会话配置不发起连接准备。写入继续保留唯一 operationId 和未知结果核对流程，读取期限不用于判定写入失败。

## 启动阶段计时

客户端控制台以 `[jiancheng-startup]` 输出以下字段：`stage`、`durationMs`、`code`。结果码为 OK、FAILED、TIMEOUT；计时回调异常不影响业务。

| stage | 含义 |
| --- | --- |
| shared_init | 首次共享鉴权与 SDK 初始化；同目标复用连接不重复计时 |
| account_pull | 账户业务函数请求，包含网络和云执行，不含共享鉴权；物理请求迟到完成时可能晚于读取超时日志 |
| state_accept | 合法账户状态校验与内存快照接收 |
| startup_read | 无已确认快照时，从核心读取发起到成功、失败或超时的总耗时 |

日志不含账户身份、用户记录、请求响应正文、凭据或环境变量；不依赖账户监控上下文，不上传 monitorApi。共享 init 提前准备的耗时与 startup_read 可能重叠，不能把各项直接相加作为首屏耗时。startup_read 不包含页面绘制，真机验收需同时记录打开到真实列表显示的总时间。

## 验证

| 检查 | 结果 |
| --- | --- |
| npm test | 613/613 通过，0 skip；其中新增启动、按需加载和入口安全回归 12 项 |
| npm run check | 518 项通过 |
| npm run check:cloud | 122 个产物与源码一致 |
| npm run openspec -- validate --all --strict | 24 项通过 |
| 微信原生 wcc / wcsc | WXML 20 个、WXSS 19 个输入通过 |
| git diff --check | 通过 |

启动回归使用内存传输、假时钟与独立 Node 进程。模块图测试在存储约束启用时验证普通 pull 一次 get；入口测试验证 guard 加载失败不落写、清理顺序与旧 epoch 重试；照片和共享 SDK 合同参与全量回归。原生编译仅确认语法。

本轮没有业务云调用、账户数据读取/写入、云部署、付费配置修改、客户端上传或发布。尚未测量手机正式版的优化后秒数，不能把本地测试耗时当成真机提速结果。

## 生效与回滚

1. 客户端涉及 app.js、app-lifecycle、cloud-transport、cloud-session 和今日页，需上传体验版并验证后再发布正式版。
2. 服务端唯一来源为 server/entries/api.js，已通过 npm run build:cloud 生成 cloudfunctions/jiancheng_daka_api/index.js。云端需要部署 jiancheng_daka_api；测试与正式环境按各自授权处理。其他函数不属于本轮部署清单。
3. 更新后分别测首次打开、短时切回、断网重连、15 秒超时重试以及迟到响应；记录共享初始化、账户读取与真实列表显示的时间。
4. 回滚本轮六个源码文件的改动片段并重新生成 API 产物，再按原部署/发布顺序更新。保留这些文件已有的监督、照片和监控改动，不对整个工作区执行 reset；账户与历史数据无需迁移。

对应变更：openspec/changes/repair-delete-and-reduce-wait。部署、正式真机与用户验收任务继续保留未完成。
