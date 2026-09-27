# 2026-09-27 正式云分阶段部署记录

## 授权与边界

用户在说明下一阶段会调整 product 中本应用 jiancheng_daka_* 资源后回复“继续吧”。本轮允许该范围内实施，不改其他小程序或 cloudbase_auth，不合并 main，不发布小程序。记录不包含身份样本、密钥、环境变量值或账户数据。

环境 product-d2g59zty74d7d1ec1，资源方 wx7ad85943fe81e095，使用方 wx58e61dffcbfa4249。源码基线 8ed505c，工作分支 dev，开发前已同步 origin/dev。

## 备份门禁与阶段调整

官方开发者工具 0.3.9 门禁通过：版本匹配、登录有效，无需额外 CLI token。只读云函数清单确认本应用已有 jiancheng_daka_api；四个新增函数均不在清单中。

现有 cloud_fn_info 只返回 name/status/timeout/runtime，没有代码包、版本摘要、下载入口或环境变量。不能据此生成可靠的线上备份，因此本轮不覆盖主函数，也不把仓库版本冒称线上备份。集合结构查询没有返回完整结构，安全规则/索引/TTL仍未核实。

微信身份文档的浏览器访问被安全策略拒绝，未尝试绕过；已查看[官方 wx-server-sdk 源码](https://github.com/wechat-miniprogram/wx-server-sdk/blob/master/index.js)，其 getWXContext 动态读取平台上下文字段，但这本身不足以证明本项目共享 FROM_* 字段的映射。身份适配和启用继续保持门禁。

## 第一阶段：仅创建未启用的新函数

精确目标：jiancheng_daka_features、jiancheng_daka_public_share、jiancheng_daka_reminder_tick、jiancheng_daka_plan。

- 不覆盖 jiancheng_daka_api，不调整共用授权。
- 不设置任何业务启用变量、不创建定时器、不填订阅模板或 AI 密钥。
- 缺少显式门禁时，入口在业务查库、消息发送或供应商访问前返回未开放状态；客户端入口仍关闭。
- 每个函数先记录异步结果，再决定后续动作。待确认不算成功，不因等待而重复部署。
- 所有新函数不存在的只读清单是创建基线，不涉及覆盖已有函数版本。
- 若部署失败，不自动删资源或放宽权限。回退先保持关闭；实际删除另列目标与恢复边界。

此阶段不表示功能已经可用，不勾选共享身份、配置备份、正式联调或上线验收。

## 部署前验证

- npm test：296 通过，0 失败、0 跳过。
- npm run check:cloud：61 个生成文件一致。
- OpenSpec strict：9 项通过。
- 实际使用 Node v16.13.0 运行 scripts/check-node16.cjs：54 个云端 JS 文件可解析，wx-server-sdk 可加载、crypto.randomUUID 可用。不是完整 Node 16 行为回归；完整自动测试仍由 Node 24 运行。
- Node 16 临时运行时来自 npm 的 node@16.13.0；未切换系统默认 Node、未修改业务依赖。

## 执行结果

已发起第一项 jiancheng_daka_features 部署，开发者工具返回待用户确认。外层 success=true 只表示确认任务创建成功，不代表云函数部署成功。

- taskId：`confirmation_cloud_fn_deploy_d6b09639-bd60-4d99-a0ac-c0f02b6441bb`
- 原工具：`cloud_fn_deploy`
- clientName：`codex`
- appid：`wx7ad85943fe81e095`
- env：`product-d2g59zty74d7d1ec1`
- path：`D:\codex\coding\yidian-miniprogram\cloudfunctions\jiancheng_daka_features`
- remote-npm-install：true
- 最后状态：pending；未主动轮询，未重发。

按 wechatide-skill 的云写确认规则，通知用户在开发者工具确认后暂停该步骤。恢复时先用 polling_task_result 查询这个旧 taskId，再按最终结果决定是否继续，不能直接重发。其余三个新函数尚未发起部署，旧主函数/配置/数据库未改。尚未验证任何新函数部署成功。

## 用户要求直接操作后的实际进展

- 用户回复“自己弄”后，查询上述旧任务一次，仍为 pending，没有重复上传。
- 使用 Windows Computer Use 技能进入本项目打开的 product 云开发控制台。主函数配置显示 Nodejs16.13、入口 index.main、256 MB、超时 3 秒；环境变量为空。仅查看本应用主函数详情，未修改配置。
- 版本表最初仅有 `$LATEST`，更新时间 2026-09-24 21:34:09、流量 100%。通过平台“创建新版本”保存现有代码与配置，控制台明确返回“发布成功，版本名称：1”。这是云函数回滚快照，不是小程序发布。
- 重新读取版本表确认版本 `1` 的更新时间为 2026-09-27 17:17:19，备注为“2026-09-27 开发前回滚快照；保留09-24线上代码及配置，不调整流量”。`$LATEST` 仍为 100%；版本 1 的流量栏为空，未操作分配流量或常驻实例。
- 本轮目前唯一正式云变更是创建主函数版本 1；未覆盖 `$LATEST`、未改变量、未创建定时器或写入账户数据。

### 恢复边界

依据[CloudBase 官方版本说明](https://docs.cloudbase.net/cloud-function/gray-release)，发布版本保存代码、配置和运行时快照，并与流量分配分开。版本 1 是平台侧恢复材料，不是本地导出的代码包，也不包含数据库备份。尚未演练真实回滚；以后需要回退时先核验版本 1、身份与数据结构兼容性，再在授权范围内安排流量，不能直接假设任意新数据都兼容旧代码。当前无需回退或删除快照。

### 当前操作边界

当前项目窗口与通知中心均没有显示与上述 taskId 对应的确认弹窗，工具菜单也未见对应任务入口。查看另一项目窗口的尝试被权限审查拒绝，未访问其内容、未换工具绕过；该项目可能包含无关资料，已向用户请求仅查找本次部署确认的具体授权，未答复前不访问。没有修改开发者工具安全设置或读取本地凭据。线上完整配置/权限/索引/TTL与共享身份门禁仍未全部满足。

## 用户明确允许查看确认窗口后的结果

用户随后回复“允许”，范围仅为在“灵感拾光簿-离线验证”窗口查找并处理这次 features 部署确认，不含该项目文件、业务操作或云资源变更。

- 恢复时查询原 taskId 一次，仍为 pending，createdAt/updatedAt 均未变化。没有重新发起部署。
- 已激活获授权的窗口，但返回的画面被其他程序遮挡，未能看清或定位匹配的确认框。最小化本项目云控制台以解除其中一层遮挡；没有关闭项目或修改内容。
- 点击目标窗口“最大化”时，Computer Use 返回 `point (1413, 260) is over ACShadows.exe "Assassin's Creed Shadows", not target window 微信开发者工具.exe "灵感拾光簿-离线验证"`，点击被拦截。按技能重新激活并刷新后画面仍不可靠，停止输入；不改用其他 UI 自动化机制绕过目标校验。
- 当前需要用户将游戏最小化，并将获授权的开发者工具窗口置于前台，随后才能安全继续查找确认；不需要再次给聊天授权，也没有证据表明用户尚未登录。
- 本次没有新云端写入，没有修改业务代码或另一项目资料。恢复时仍先查询原任务；此前主函数版本 1 保留不动，未合并 main 或发布小程序。

## 19:56 后恢复：旧任务丢失与独立新函数确认

- 用户再次要求继续后，本项目窗口可正常观察，前次游戏遮挡不再作为当前阻塞。此前获准查看的“灵感拾光簿-离线验证”窗口已不在清单中；没有访问新出现的其他项目窗口。
- 查询旧 features taskId 时 CLI 首先提示连接失败并自动尝试 auth，随后连接恢复，但原查询返回 `Task not found`。之后 status 核验版本 equal、登录有效、tokenRequired=false。没有操作安全设置或读取凭据。旧任务目前状态未知，不把它擅自归为 cancelled/failed，也未重新部署 features。
- 正式函数清单仍只有本应用主函数及其他应用函数，没有四个新增函数。`npm run check:cloud` 再次通过，61 个生成文件一致。
- 在已授权的四函数阶段范围内，首次提交尚无旧任务的 `jiancheng_daka_public_share`。无功能变量、无定时器或客户端启用，未覆盖主函数。返回以下确认任务，尚不代表部署成功：
  - taskId：`confirmation_cloud_fn_deploy_c74ad372-54a1-4fcb-9a43-2233ccab0904`
  - tool/client：`cloud_fn_deploy` / `codex`
  - appid/env：`wx7ad85943fe81e095` / `product-d2g59zty74d7d1ec1`
  - path：`D:\codex\coding\yidian-miniprogram\cloudfunctions\jiancheng_daka_public_share`
  - remote-npm-install：true
  - 最后任务状态：pending。
- 本项目截图出现明确部署 public_share 的确认框。针对主窗口截图中的“允许”操作后，确认框被主窗口遮住；查询原任务一次仍 pending，云清单仍无新增函数，因此该点击未获得实际确认成功证据。
- 定位到新出现的独立无标题窗口，尝试激活、Raise、暂时最小化主窗口解除遮挡，返回画面仍是其他窗口内容，未能可靠定位确认按钮。已停止对确认框输入并恢复本项目主窗口；不以旧坐标盲点，不改用未授权自动化机制。
- 下一步需要用户在标明 `jiancheng_daka_public_share` 的开发者工具确认框点击“允许”；不要关闭/重启开发者工具导致当前确认记录再次丢失。之后先读取 public_share 原 taskId 结果，不重新上传。features 旧任务丢失仍独立保留为未决问题；plan/reminder_tick 尚未提交。
- 没有业务代码改动，没有新增函数部署成功证据；不能说新功能已可用或已完成上线。无云配置、数据库、main 或小程序发布变更。

## 手动确认后的首次执行结果与一次修复重试

用户回复“已点”后读取 public_share 原任务，确认交互已结束：外层 `status=success`、`detail=execution_success`，但内层 `result.jiancheng_daka_public_share.error` 明确报告代码更新失败。必须检查内层资源结果，不能以确认任务的 success 宣告部署完成。

- 错误码：`FailedOperation.UpdateFunctionCode`。
- 错误原文：“当前函数处于Creating状态，无法进行此操作，请稍后重试。”
- RequestId：`9c37e75f-e13c-4567-8bdb-c0675cf13d17`。
- 随后只读查询 `jiancheng_daka_public_share` 已为 Active、Nodejs16.13、超时 3 秒；旧主函数 `jiancheng_daka_api` 同样 Active。这证明新函数资源已创建，不证明仓库业务代码及依赖已经部署。
- 首次执行已进入终态且内层更新明确失败，因此仅对同一 public_share 函数重试一次失败的完整代码部署，继续使用同一 appid/env/path 和 remote-npm-install=true。不删除/重建资源，不设置启用变量，不重试状态未知的 features。
- 修复任务：`confirmation_cloud_fn_deploy_385f9ede-ab51-4486-a1ad-ad9aaaca6ddf`，tool/client 为 `cloud_fn_deploy` / `codex`，最后状态 pending。已通知用户确认这个新任务；不要再查询旧的 c74ad372 任务来判断本次结果。
- 后续先读取修复任务的内层结果，再查实际函数状态；成功后仍需受控验证关闭响应。若仍出现 Creating/CreateFailed 或其他错误，停止重复部署并保留实际错误，不能删除函数试错。
- 本回合无业务代码更改；已同步 dev。当前云端已有 public_share 新资源、未验证成功更新；主函数和客户端配置未修改，plan/reminder_tick 未提交。

## public_share 修复部署成功与下一项

用户确认修复弹窗后，任务 `confirmation_cloud_fn_deploy_385f9ede-ab51-4486-a1ad-ad9aaaca6ddf` 返回终态 success，内层 `jiancheng_daka_public_share` 返回 `filesCount=11`、`packSize=27.2 KB`，无资源 error。后续 cloud_fn_info 确认该函数 Active。这次取得了业务代码上传成功证据，不只是资源创建成功。

随后逐一核对 plan/reminder_tick 均返回 `ResourceNotFound.Function`，在既定授权范围首次提交 plan：

- taskId：`confirmation_cloud_fn_deploy_77e095df-53d5-45a4-b4df-ac39e432e28e`
- tool/client：`cloud_fn_deploy` / `codex`
- appid/env：`wx7ad85943fe81e095` / `product-d2g59zty74d7d1ec1`
- path：`D:\codex\coding\yidian-miniprogram\cloudfunctions\jiancheng_daka_plan`
- remote-npm-install：true；最后状态 pending；已请用户确认，未轮询或重发。
- AI 所有启用变量、供应商密钥及客户端开关均未设置/启用，不调用模型。reminder_tick 尚未发起；features 丢失任务仍未重发。

### 公开函数受控调用的结果及限制

- 使用官方 automator 场景，明确目标仍为本工程 `pages/today/index`。只构造该正式环境共享实例，请求公开函数和固定全零无效 shareId，不调用私有主接口、不创建账户、写记录、订阅或发送消息。
- 首次表达式因 Windows 命令引号解析报 `Uncaught init is not defined`，发生在初始化前；改为单引号 JS 字符串后消除此工具参数问题。
- 共享实例 init 完成后，callFunction 报 `errCode=-1`。通过限定关键词、再脱敏短文本取证得到：`Cloud API isn't enabled, please call wx.cloud.init first / 请先调用 wx.cloud.init() 完成初始化后再调用其他云 API。`
- 在同一受控表达式先调用 `wx.cloud.init({traceUser:false})` 再初始化共享实例，仍得到相同错误；没有切换活动配置或调用默认环境业务函数。
- 使用 `automation_wx_api --action call --method cloud.init` 的独立诊断返回 `Uncaught TypeError: wx.cloud.init is not a function`。不能由此断言真实小程序不支持该 API：工具对嵌套 method 的处理和 evaluate 上下文尚需区分。未据此修改 cloud-transport 或放宽门禁。
- 诊断参数文件 `qa/local/20260927-acceptance/sdk-init-args.json` 仅含 traceUser=false，在 Git 忽略目录；不含身份、密钥或生产数据。
- 没有取得预期 SHARE_UNAVAILABLE 云响应，因此未勾选共享调用或正式功能验收。现有单测与结构检查不能替代该证据；public_share 的状态是“代码部署成功、真实共享调用未通过”，不是“分享功能已可用”。

## plan 原任务已结束，21:13 后补传恢复

用户反馈“没有看到弹窗”后查询原 plan 任务 `77e095df-53d5-45a4-b4df-ac39e432e28e`：确认交互实际上早已执行结束。外层 success，内层 `jiancheng_daka_plan.error` 报 `FailedOperation.UpdateFunctionCode`，原文“当前函数处于Creating状态，无法进行此操作，请稍后重试。”，RequestId `1d5d8387-4eb4-4459-b3cd-09b7f2129f4c`。不能继续让用户查找这个已结束的旧确认框；已向用户更正之前的待确认描述。

- 只读核验 plan 已 Active。首次准备补传时自动审批服务因额度不足拒绝执行命令，明确说明操作未执行，因此那次没有新部署任务或云写入；没有改用别的通道绕过。
- 用户再次要求继续后，核实当前北京时间已过审批提示恢复时间（21:13），通过同一审批通道只读查询成功，plan 仍 Active，再首次真正发起失败代码的补传。
- 新补传 taskId：`confirmation_cloud_fn_deploy_b4fd7fbc-1fee-447b-a669-c9d65ea14e12`；tool/client 为 cloud_fn_deploy/codex；appid/env/path/remote-npm-install 沿用 plan 原参数；最后已知状态 pending。
- Computer Use 已捕获明确标明 jiancheng_daka_plan 的独立确认框。按既有授权点击“允许”时，工具报告点击落点为 ChatGPT 窗口而非目标，操作被拦截；重新激活后截图仍被遮挡。停止点击，没有操作聊天界面、修改安全设置或按旧坐标盲点。
- 已请用户手动确认这个新的补传任务。用户答复后先查 b4fd7fbc 任务并检查内层资源结果，不能再用原 77e095df 任务或之前的截图来判断当前状态。
- 本阶段仍未获得 plan 业务代码上传成功证据。public_share 部署成功但调用未通过；features 旧任务未知；reminder_tick 未提交。未启用任何新能力、调用 AI 模型或修改主函数。

## plan 补传成功，首次提交提醒执行函数

用户回复“允许了”后，读取 plan 补传任务 `confirmation_cloud_fn_deploy_b4fd7fbc-1fee-447b-a669-c9d65ea14e12`：外层 success/execution_success，内层 `jiancheng_daka_plan` 返回 `filesCount=16`、`packSize=36.2 KB`，没有资源 error。随后只读查询确认 plan 为 Active、Nodejs16.13、超时 3 秒。这证明代码上传成功，不证明 AI 已启用或真实建议验收完成；未配置供应商密钥、启用变量或调用模型。

- 同次只读查询发现 `jiancheng_daka_features` 已为 Active、Nodejs16.13、超时 3 秒。此前丢失的 features 任务没有恢复终态，不能将这个资源状态视为已验证代码版本；未再次创建或上传该函数，代码及真实调用仍待核验。
- `jiancheng_daka_reminder_tick` 同次查询仍为 `ResourceNotFound.Function`，因此在已授权范围内首次提交该函数。上传包不包含定时触发器配置；不启用提醒、不发送消息、不修改主函数或共享认证配置。
- 新 pendingTask：
  - taskId：`confirmation_cloud_fn_deploy_643b8c20-c4ef-4910-b6e8-0e0730a8b008`
  - tool/client：`cloud_fn_deploy` / `codex`
  - appid/env：`wx7ad85943fe81e095` / `product-d2g59zty74d7d1ec1`
  - path：`D:\codex\coding\yidian-miniprogram\cloudfunctions\jiancheng_daka_reminder_tick`
  - remote-npm-install：true；最后状态 pending；已通知用户确认，没有主动轮询或重发。
- 恢复顺序：用户确认后先查上述 reminder_tick 原任务并检查内层结果。若首次创建发生明确的 Creating 代码更新失败，先查资源状态再决定是否只补传失败代码；不得删除重建、重复提交 pending 任务或将外层 success 当成部署成功。
- 当前已验证代码上传的是 public_share 和 plan；features 仅确认资源 Active，reminder_tick 待确认。正式共享调用、数据库规则/索引/TTL、真实消息和 AI 等验收仍未完成，活动客户端配置保持不变。

### 同回合补充只读诊断

- 本工程模拟器通过受控表达式返回 `cloudSession.phase=ready`、configured/consented/connected 均为 true；`wx.cloud.init`、`wx.cloud.callFunction`、`wx.cloud.Cloud` 均为 function，基础库为 3.17.3。仅读取布尔值、阶段及 API 类型，没有输出账户 ID、缓存内容或原始云响应。这些结果不能单独证明当前网络请求成功。
- 在该上下文执行一次新共享实例的受控公开调用：初始化步骤完成，仍在 call 阶段返回 errCode=-1 和 `Cloud API isn't enabled, please call wx.cloud.init first`。尚未拿到业务层 SHARE_UNAVAILABLE 响应；没有依据此错误修改业务初始化、切换活动云配置或放宽权限。
- 核对了 [CloudBase 官方共享实例示例](https://docs.cloudbase.net/run/develop/access/mini)；示例是云托管 callContainer 场景，不能用它冒充当前云函数调用已验收。当前 SDK 类型可用与共享调用成功是不同证据，后续仍需定位实例/工具上下文和真实调用路径。
- `npm run check:cloud` 再次通过，61 个生成文件与源码一致；`git diff --check` 通过。本次仅变更部署记录，没有业务代码改动，也未重新执行全量单测或真机验收。
