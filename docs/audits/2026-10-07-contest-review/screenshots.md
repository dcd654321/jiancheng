# 渐成审查与改版截图说明

整理日期：2026-10-08。画廊：[index.html](index.html)。共 **32张基线 + 42张改版 = 74张**，均为团队已目检选择。基线只收录指定ID；改版01–43除39全部收录。点击链接打开原始PNG；画廊lazy load、完整保留比例、不裁切、不发起外部请求。

## 证据等级与环境

|代码|日期与环境|范围|
|---|---|---|
|B390|2026-10-07；Windows；微信开发者工具；基础库3.17.3；platform=devtools；API逻辑窗390×671px，屏幕390×844px|基线dev 1f75d0b|
|P390|2026-10-08；Windows；微信开发者工具；基础库3.17.3；platform=devtools；API逻辑窗390×671px|改版01–36|
|P320|2026-10-08；Windows；开发工具iPhone5模拟；基础库3.17.3；platform=devtools；API逻辑窗320×456px|改版37–43；非真机|

- **W：真实开发版账户只读**及不调用AI的本机规则预览。支持页面、导航、已显示数据；不证明真实云写入、正式线上、生产AI或消息发送。
- **F：隔离内存模拟**。假账户/回执、模拟错误/延迟或领域函数只在内存；公开能力仅会话开启。不是实际卡片接收或真实用户行为。
- 全量真实业务云端写入 **0**、生产AI请求 **0**、真实消息发送 **0**。没有真机键盘/安全区、真实保存/AI/分享、双账户或用户测试验收。
- 基线W初始云确认在 **10/04**，是历史已确认状态，不称10/07当前云读。改版01的lastSyncedAt为 **2026-10-07T22:59:21.769Z**，即北京时间 **2026-10-08 06:59:21.769**，仅此次只读云返回确认。
- PNG显示缩放不等于API逻辑控件尺寸。前后演示目标可不同；新阅读模板推荐5/1分钟，已有/演示计划可为5/2，均同unit，不重写已有目标。

## 状态修正与排除

1. **基线32（32-completed-expanded-F.png）**实际完成分组收起。只证明确认后的收起/查看入口，不证明展开或持续撤销。
2. **改版10（10-creating-F.png）**实际已返回今日且有已创建toast。真正等待是 **改版41**，10秒内存延迟、edit创建按钮加载；不是云端耗时测量。
3. **改版39（39-calendar-320-F.png）**日历裁切，排除；由已目检42/43替代。日期格44×73.59375px，容器宽288px，近7天高76px、近28天高312px。原清单80px容器高度是修复前历史测量。
4. 基线03/10/11/20未到达目标页，不证明模板确认、基础确认、管理或首次模板确认；稳定替代23/25/27。其他未选基线只保留采集清单，不作为已目检证据。
5. 原page/steps保留采集历史，本次仅更新 **caption/health**。已知错误状态以caption/health和本说明为准。“已目检”只说明图像状态已核对，不等于功能通过。

## 快速前后对比

|流程|基线|改版|可以比较|
|---|---|---|---|
|模板确认|[27](27-first-confirm-F.png)|[06](post-change/06-template-confirm-F.png)|默认目标、双档与文案|
|今日任务|[01](01-today-W.png)|[02](post-change/02-today-W.png)|操作密度、层级、原目标保留|
|返回草稿|[41](41-dirty-form-F.png)→[42](42-form-reentry-F.png)|[07](post-change/07-dirty-input-F.png)→[08](post-change/08-draft-reentry-F.png)|该会话场景是否接续输入|
|完成/撤销|[33](33-minimum-done-F.png)→[34](34-undo-minimum-F.png)|[14](post-change/14-completed-F.png)→[15](post-change/15-undo-F.png)|记录数量与当前目标语义|
|进度|[36](36-progress-facts-F.png)|[16](post-change/16-progress-F.png)→[17](post-change/17-progress-adjust-F.png)|事实/分母、对应明日入口|
|基础建议|[09](09-rules-preview-W.png)|[04](post-change/04-basic-preview-W.png)|基础优先与预览层级|
|AI失败|[45](45-ai-failure-F.png)|[21](post-change/21-ai-failure-F.png)→[22](post-change/22-ai-recovery-F.png)|模拟恢复，不是生产AI质量|
|读取中|[47](47-loading-F.png)|[23](post-change/23-loading-F.png)|示例与用途可见性|
|接收路径|[54](54-share-receiver-plan-F.png)、[58](58-share-account-loading-F.png)|[30](post-change/30-share-receiver-F.png)、[34](post-change/34-account-wait-F.png)→[35](post-change/35-account-failure-F.png)→[36](post-change/36-account-recovery-F.png)|使用主操作与账户准备|
|窄屏|无对应已目检基线|[37](post-change/37-today-320-F.png)、[42](post-change/42-calendar-320-fixed-F.png)、[43](post-change/43-calendar28-320-fixed-F.png)|仅工具320px逻辑布局与尺寸|

## 基线 · 2026-10-07（32张）

|原始PNG|页面|目检状态|操作步骤|环境/等级|说明与限制|
|---|---|---|---|---|---|
|[基线01 · 01-today-W.png](01-today-W.png)|pages/today/index|已有今日安排；双档记录操作|重入今日；真实开发版账户，只读|B390；W|基线W初始显示上次云确认在10/04，不证明10/07实时云读取。|
|[基线02 · 02-chooser-W.png](02-chooser-W.png)|pages/today/index|添加习惯的方向选择|今日→添加习惯|B390；W|只读页面/本机规则，不含保存、生产AI或消息发送。|
|[基线05 · 05-progress-W.png](05-progress-W.png)|pages/progress/index|近7天进度|切换进度近7天|B390；W|只读页面/本机规则，不含保存、生产AI或消息发送。|
|[基线06 · 06-progress28-W.png](06-progress28-W.png)|pages/progress/index|近28天进度|近28天；未修改记录|B390；W|只读页面/本机规则，不含保存、生产AI或消息发送。|
|[基线07 · 07-mine-W.png](07-mine-W.png)|pages/mine/index|我的导航与能力入口|我的；核对当前已开放入口|B390；W|只读页面/本机规则，不含保存、生产AI或消息发送。|
|[基线08 · 08-assistant-W.png](08-assistant-W.png)|pages/assistant/index|助手输入；未请求AI|我的→AI助手；未申请AI|B390；W|只读页面/本机规则，不含保存、生产AI或消息发送。|
|[基线09 · 09-rules-preview-W.png](09-rules-preview-W.png)|pages/assistant/index|本机规则建议预览|点击查看基础方案；本机规则|B390；W|只读页面/本机规则，不含保存、生产AI或消息发送。|
|[基线12 · 12-sync-W.png](12-sync-W.png)|pages/sync/index|同步与账户只读状态|直接进入路由，仅观察；未清除、保存或订阅|B390；W|此基线同步时间为历史已确认时间，不是当前云确认。|
|[基线14 · 14-appearance-W.png](14-appearance-W.png)|pages/appearance/index|外观主题选择与预览|直接进入路由，仅观察；未清除、保存或订阅|B390；W|只读页面/本机规则，不含保存、生产AI或消息发送。|
|[基线23 · 23-template-stable-W.png](23-template-stable-W.png)|pages/edit/index|阅读模板可编辑确认|真实模板按钮点击，确认route后等待渲染；未保存|B390；W|只读页面/本机规则，不含保存、生产AI或消息发送。|
|[基线25 · 25-manage-stable-W.png](25-manage-stable-W.png)|pages/manage/index|习惯管理列表|真实习惯管理，只读|B390；W|只读页面/本机规则，不含保存、生产AI或消息发送。|
|[基线27 · 27-first-confirm-F.png](27-first-confirm-F.png)|pages/edit/index|首次模板确认页|点击第一张阅读模板→可编辑确认|B390；F|假账户/回执/错误/延迟只在内存；真实云写、AI请求、消息发送均为0。|
|[基线28 · 28-invalid-target-F.png](28-invalid-target-F.png)|pages/edit/index|非法目标提交后的错误提示|自动化输入0；不能证明真机键盘|B390；F|自动化写值不证明真机键盘、焦点或遮挡。|
|[基线29 · 29-first-created-F.png](29-first-created-F.png)|pages/today/index|内存创建确认后返回今日|内存确认创建成功返回今日；未写云|B390；F|假账户/回执/错误/延迟只在内存；真实云写、AI请求、消息发送均为0。|
|[基线30 · 30-busy-completed-F.png](30-busy-completed-F.png)|pages/today/index|忙时记录确认反馈与撤销入口|点击忙时目标，内存确认；可撤销|B390；F|假账户/回执/错误/延迟只在内存；真实云写、AI请求、消息发送均为0。|
|[基线31 · 31-completion-settled-F.png](31-completion-settled-F.png)|pages/today/index|短反馈自动收起后的完成内容|成功反馈自动收起后|B390；F|假账户/回执/错误/延迟只在内存；真实云写、AI请求、消息发送均为0。|
|[基线32 · 32-completed-expanded-F.png](32-completed-expanded-F.png)|pages/today/index|完成分组收起；可见查看入口|确认记录后观察完成分组收起；未取得本图展开/持续撤销证据|B390；F|文件名含expanded，实际分组收起；不证明展开或持续撤销。原steps描述由本caption纠正。|
|[基线33 · 33-minimum-done-F.png](33-minimum-done-F.png)|pages/today/index|忙时2分钟结果语义|真实领域reducer内存完成忙时2分钟；已完成卡|B390；F|出现“今天已调小”，支持记录/调整语义问题；长期习惯目标未因此改写。|
|[基线34 · 34-undo-minimum-F.png](34-undo-minimum-F.png)|pages/today/index|撤销后当天小目标保留|真实领域reducer撤销；检查今天目标是否保留较小值|B390；F|与33配对可见小目标保留；非云端撤销证明。|
|[基线35 · 35-return-F.png](35-return-F.png)|pages/today/index|轻松回来提示|多日未记录夹具→轻松回来|B390；F|假账户/回执/错误/延迟只在内存；真实云写、AI请求、消息发送均为0。|
|[基线36 · 36-progress-facts-F.png](36-progress-facts-F.png)|pages/progress/index|进度事实：原目标2次/忙时3次|7天夹具，原目标2次/忙时3次|B390；F|390px逻辑窗实测日期格46.28125×73.59375px，不能推及320px。|
|[基线38 · 38-detail-F.png](38-detail-F.png)|pages/detail/index|习惯详情与安排|习惯详情|B390；F|假账户/回执/错误/延迟只在内存；真实云写、AI请求、消息发送均为0。|
|[基线39 · 39-note-expanded-F.png](39-note-expanded-F.png)|pages/detail/index|备注编辑展开；尚未保存|展开备注；未提交|B390；F|假账户/回执/错误/延迟只在内存；真实云写、AI请求、消息发送均为0。|
|[基线41 · 41-dirty-form-F.png](41-dirty-form-F.png)|pages/edit/index|未保存的表单输入|自动化输入未提交草稿|B390；F|与42配对审查会话输入返回；非真机键盘证据。|
|[基线42 · 42-form-reentry-F.png](42-form-reentry-F.png)|pages/edit/index|返回重入后重新初始化|返回后重开相同模板；核对输入未保留|B390；F|假账户/回执/错误/延迟只在内存；真实云写、AI请求、消息发送均为0。|
|[基线44 · 44-ai-preview-F.png](44-ai-preview-F.png)|pages/assistant/index|模拟AI成功建议|模拟AI成功，无供应商请求|B390；F|假账户/回执/错误/延迟只在内存；真实云写、AI请求、消息发送均为0。|
|[基线45 · 45-ai-failure-F.png](45-ai-failure-F.png)|pages/assistant/index|模拟AI额度错误|模拟额度错误|B390；F|假账户/回执/错误/延迟只在内存；真实云写、AI请求、消息发送均为0。|
|[基线47 · 47-loading-F.png](47-loading-F.png)|pages/today/index|今日云数据读取中|模拟DATA_LOADING|B390；F|假账户/回执/错误/延迟只在内存；真实云写、AI请求、消息发送均为0。|
|[基线48 · 48-read-failure-F.png](48-read-failure-F.png)|pages/today/index|读取失败；修改受限|模拟读取失败，禁止修改|B390；F|假账户/回执/错误/延迟只在内存；真实云写、AI请求、消息发送均为0。|
|[基线54 · 54-share-receiver-plan-F.png](54-share-receiver-plan-F.png)|pages/share-view/index|接收轻计划；再分享为主操作|模拟接收者轻计划|B390；F|假账户/回执/错误/延迟只在内存；真实云写、AI请求、消息发送均为0。|
|[基线56 · 56-share-invite-F.png](56-share-invite-F.png)|pages/share-view/index|邀请接收页|模拟邀请，检查开始入口|B390；F|假账户/回执/错误/延迟只在内存；真实云写、AI请求、消息发送均为0。|
|[基线58 · 58-share-account-loading-F.png](58-share-account-loading-F.png)|pages/share-view/index|公开已读；私人账户未就绪时采用报错|公开内容成功、私有账户未就绪，采用报错|B390；F|假账户/回执/错误/延迟只在内存；真实云写、AI请求、消息发送均为0。|

## 本地改版 · 2026-10-08（42张）

|原始PNG|页面|目检状态|操作步骤|环境/等级|说明与限制|
|---|---|---|---|---|---|
|[改版01 · 01-cloud-read-W.png](post-change/01-cloud-read-W.png)|pages/sync/index|当前已确认云端只读状态|检查当前已确认的云端读取时间；不执行真实写操作|P390；W|lastSyncedAt=2026-10-07T22:59:21.769Z，即北京时间2026-10-08 06:59:21.769；仅此次云读取确认，不证明写入。|
|[改版02 · 02-today-W.png](post-change/02-today-W.png)|pages/today/index|已有账户今日；保留原有目标|改版真实开发账户今日；仅观察原有目标|P390；W|已有目标没有被新的模板默认值静默重写。|
|[改版03 · 03-assistant-basic-W.png](post-change/03-assistant-basic-W.png)|pages/assistant/index|基础建议优先；AI未展开|基础优先，未展开AI，无供应商请求|P390；W|只读页面/本机规则，不含保存、生产AI或消息发送。|
|[改版04 · 04-basic-preview-W.png](post-change/04-basic-preview-W.png)|pages/assistant/index|基础规则预览；未创建|基础规则预览，未创建|P390；W|只读页面/本机规则，不含保存、生产AI或消息发送。|
|[改版05 · 05-first-empty-F.png](post-change/05-first-empty-F.png)|pages/today/index|首次空态；整理3/1主入口|模拟空账户；整理3分钟主入口|P390；F|假账户/回执/错误/延迟只在内存；真实云写、AI请求、消息发送均为0。|
|[改版06 · 06-template-confirm-F.png](post-change/06-template-confirm-F.png)|pages/edit/index|整理3/1模板确认|实际点击整理主入口→3/1确认页；未保存|P390；F|假账户/回执/错误/延迟只在内存；真实云写、AI请求、消息发送均为0。|
|[改版07 · 07-dirty-input-F.png](post-change/07-dirty-input-F.png)|pages/edit/index|未保存表单与会话草稿|修改名称/目标；会话草稿，无云写入|P390；F|假账户/回执/错误/延迟只在内存；真实云写、AI请求、消息发送均为0。|
|[改版08 · 08-draft-reentry-F.png](post-change/08-draft-reentry-F.png)|pages/edit/index|返回重入后输入接续|返回后点击相同入口；输入接续成功|P390；F|draftCheck记录名称“整理我的桌面”、target=4、restored=true；仅此会话场景证据。|
|[改版09 · 09-invalid-target-F.png](post-change/09-invalid-target-F.png)|pages/edit/index|目标0字段错误与输入保留|目标0提交；字段错误与输入保留|P390；F|假账户/回执/错误/延迟只在内存；真实云写、AI请求、消息发送均为0。|
|[改版10 · 10-creating-F.png](post-change/10-creating-F.png)|pages/today/index|创建成功后今日与已创建toast|执行保存后采集时已返回今日并显示“已创建”toast；2200ms等待未被此图捕获|P390；F|文件名creating及原steps不能代表等待态；真正等待证据是post41。|
|[改版11 · 11-created-F.png](post-change/11-created-F.png)|pages/today/index|创建确认后今日任务|fixture创建确认后回今日|P390；F|假账户/回执/错误/延迟只在内存；真实云写、AI请求、消息发送均为0。|
|[改版12 · 12-recording-F.png](post-change/12-recording-F.png)|pages/today/index|忙时记录等待；按钮防重复|调用忙时事件，内存等待2200ms；防连点|P390；F|内存模拟2200ms延迟，不是实测云端耗时。|
|[改版13 · 13-feedback-F.png](post-change/13-feedback-F.png)|pages/today/index|记录确认短反馈与撤销|确认后已记下＋撤销|P390；F|假账户/回执/错误/延迟只在内存；真实云写、AI请求、消息发送均为0。|
|[改版14 · 14-completed-F.png](post-change/14-completed-F.png)|pages/today/index|本次记录中性呈现；平时目标保留|中性本次记录，平时目标保留|P390；F|假账户/回执/错误/延迟只在内存；真实云写、AI请求、消息发送均为0。|
|[改版15 · 15-undo-F.png](post-change/15-undo-F.png)|pages/today/index|撤销后今天目标呈现|撤销后显示当前今天目标，不推断调整来源|P390；F|假账户/回执/错误/延迟只在内存；真实云写、AI请求、消息发送均为0。|
|[改版16 · 16-progress-F.png](post-change/16-progress-F.png)|pages/progress/index|进度事实、分母与明日行动|事实、分母、明日调整|P390；F|390px逻辑窗日期格46.28125×73.59375px。|
|[改版17 · 17-progress-adjust-F.png](post-change/17-progress-adjust-F.png)|pages/edit/index|从进度进入对应明日编辑|进度直接到对应习惯明日编辑；不改历史|P390；F|假账户/回执/错误/延迟只在内存；真实云写、AI请求、消息发送均为0。|
|[改版18 · 18-assistant-preview-F.png](post-change/18-assistant-preview-F.png)|pages/assistant/index|基础建议预览；无AI发送|基础先行，未发送AI|P390；F|假账户/回执/错误/延迟只在内存；真实云写、AI请求、消息发送均为0。|
|[改版19 · 19-ai-opt-in-F.png](post-change/19-ai-opt-in-F.png)|pages/assistant/index|主动展开AI；尚未同意|主动展开AI，同意未勾选|P390；F|假账户/回执/错误/延迟只在内存；真实云写、AI请求、消息发送均为0。|
|[改版20 · 20-ai-fixture-preview-F.png](post-change/20-ai-fixture-preview-F.png)|pages/assistant/index|模拟AI成功预览|调用AI事件，模拟成功；无供应商请求|P390；F|假账户/回执/错误/延迟只在内存；真实云写、AI请求、消息发送均为0。|
|[改版21 · 21-ai-failure-F.png](post-change/21-ai-failure-F.png)|pages/assistant/index|模拟额度失败；选择保留|模拟额度失败；保留选择|P390；F|假账户/回执/错误/延迟只在内存；真实云写、AI请求、消息发送均为0。|
|[改版22 · 22-ai-recovery-F.png](post-change/22-ai-recovery-F.png)|pages/assistant/index|AI错误后基础预览恢复|错误后本机基础方案仍可预览|P390；F|假账户/回执/错误/延迟只在内存；真实云写、AI请求、消息发送均为0。|
|[改版23 · 23-loading-F.png](post-change/23-loading-F.png)|pages/today/index|读取中价值与示例仍可读|DATA_LOADING，价值与示例仍可读|P390；F|示例非账户记录，不能离线修改。|
|[改版24 · 24-read-failure-F.png](post-change/24-read-failure-F.png)|pages/today/index|读取失败；禁止更新|模拟无记录可读，禁止更新|P390；F|假账户/回执/错误/延迟只在内存；真实云写、AI请求、消息发送均为0。|
|[改版25 · 25-read-recovery-F.png](post-change/25-read-recovery-F.png)|pages/today/index|读取重试恢复|模拟读取重试恢复|P390；F|假账户/回执/错误/延迟只在内存；真实云写、AI请求、消息发送均为0。|
|[改版26 · 26-write-failure-F.png](post-change/26-write-failure-F.png)|pages/today/index|写入结果未知；可核对|写入未确认，无成功标记，可核对|P390；F|未知保存结果，不能说明确失败或成功。|
|[改版27 · 27-share-source-F.png](post-change/27-share-source-F.png)|pages/share-create/index|轻计划来源已预选|详情→预选来源；源码开关仍关闭|P390；F|公开能力仅内存开启，源码门禁仍关闭。|
|[改版28 · 28-share-preview-F.png](post-change/28-share-preview-F.png)|pages/share-create/index|匿名公开内容预览|模拟脱敏预览，不公开真实数据|P390；F|演示计划5/2分钟不等于新模板默认值；两个目标共用分钟unit。|
|[改版29 · 29-share-owner-F.png](post-change/29-share-owner-F.png)|pages/share-view/index|本人分享页；发送为主动作|分享者发送主按钮；不发送|P390；F|回调title/path/imageUrl不等于发送或送达；delivered=false。|
|[改版30 · 30-share-receiver-F.png](post-change/30-share-receiver-F.png)|pages/share-view/index|接收者采用为主动作|接收者主按钮用计划开始|P390；F|假账户/回执/错误/延迟只在内存；真实云写、AI请求、消息发送均为0。|
|[改版31 · 31-share-confirm-F.png](post-change/31-share-confirm-F.png)|pages/edit/index|采用后编辑确认；尚未创建|准备账户后到确认页，尚未创建|P390；F|假账户/回执/错误/延迟只在内存；真实云写、AI请求、消息发送均为0。|
|[改版32 · 32-invite-F.png](post-change/32-invite-F.png)|pages/share-view/index|邀请接收者的小目标入口|邀请接收者有选择小目标入口|P390；F|假账户/回执/错误/延迟只在内存；真实云写、AI请求、消息发送均为0。|
|[改版33 · 33-weekly-F.png](post-change/33-weekly-F.png)|pages/share-view/index|周进展接收者的小目标入口|周记接收者有选择小目标入口|P390；F|假账户/回执/错误/延迟只在内存；真实云写、AI请求、消息发送均为0。|
|[改版34 · 34-account-wait-F.png](post-change/34-account-wait-F.png)|pages/share-view/index|公开内容保留；账户准备中|公开内容保留，私有账户准备中且按钮防重复|P390；F|假账户/回执/错误/延迟只在内存；真实云写、AI请求、消息发送均为0。|
|[改版35 · 35-account-failure-F.png](post-change/35-account-failure-F.png)|pages/share-view/index|账户失败；内容与重试保留|账户失败保留公开内容与采用重试|P390；F|假账户/回执/错误/延迟只在内存；真实云写、AI请求、消息发送均为0。|
|[改版36 · 36-account-recovery-F.png](post-change/36-account-recovery-F.png)|pages/edit/index|账户恢复后仍需明确创建|恢复后仍需显式创建，未自动写入|P390；F|假账户/回执/错误/延迟只在内存；真实云写、AI请求、消息发送均为0。|
|[改版37 · 37-today-320-F.png](post-change/37-today-320-F.png)|pages/today/index|320px今日；双档纵排|开发工具iPhone5模拟320px逻辑窗口，观察双档操作纵排|P320；F|normal/busy各254×68px；仅API逻辑尺寸，非真机手指测试。|
|[改版38 · 38-edit-320-F.png](post-change/38-edit-320-F.png)|pages/edit/index|320px编辑输入与星期选择|320表单输入与周选择；未保存|P320；F|未验证真实键盘遮挡。|
|[改版40 · 40-first-320-F.png](post-change/40-first-320-F.png)|pages/today/index|320px首次入口|320首屏整理入口；列表可纵向滚动|P320；F|假账户/回执/错误/延迟只在内存；真实云写、AI请求、消息发送均为0。|
|[改版41 · 41-creating-pending-F.png](post-change/41-creating-pending-F.png)|pages/edit/index|创建等待；按钮加载与防重复|注入10秒内存等待，观察edit创建按钮加载；未执行真实写入|P320；F|10秒内存延迟的创建等待；不是云端耗时测量。|
|[改版42 · 42-calendar-320-fixed-F.png](post-change/42-calendar-320-fixed-F.png)|pages/progress/index|320px近7天日历；完整且选中日期可见|320宽度，近7天，按真实网格测量横滑高度；选中日期滚入视口；未写云|P320；F|API已断言320px逻辑窗口；日期格44×73.59375px，容器288×76px；选中的2026-10-08格在横滑视口右侧完整可见；替代裁切post39。|
|[改版43 · 43-calendar28-320-fixed-F.png](post-change/43-calendar28-320-fixed-F.png)|pages/progress/index|320px近28天日历；完整且选中日期可见|320宽度，近28天，按真实网格测量横滑高度；选中日期滚入视口；未写云|P320；F|API已断言320px逻辑窗口；日期格44×73.59375px，容器288×312px；选中的2026-10-08格在横滑视口右侧完整可见；替代裁切post39。|

## 逻辑尺寸测量

|截图|API测量|有限结论|
|---|---|---|
|基线36/改版16|390px窗；日期格46.28125×73.59375px|仅该宽度下触区超过44px|
|改版37|320px窗；两操作各254×68px|纵排动作达到建议尺寸，非手指测试|
|改版42|320px窗；日期格44×73.59375px；容器288×76px|近7天裁切修复后证据|
|改版43|320px窗；日期格44×73.59375px；容器288×312px|近28天四行裁切修复后证据|

## 原清单与剩余验证

基线：[steps.json](steps.json)、[steps-continued.json](steps-continued.json)、[steps-remaining.json](steps-remaining.json)。改版：[steps.json](post-change/steps.json)、[steps-remaining.json](post-change/steps-remaining.json)、[steps-narrow.json](post-change/steps-narrow.json)、[steps-calendar.json](post-change/steps-calendar.json)。采集历史与本次目检说明应共同阅读。

剩余：真实云创建/记录/撤销/重入、两账户隔离、生产AI及同意、真实分享/接收/撤回/到期、iOS/Android键盘/安全区/大字/前后台、用户理解/耗时/错误恢复/回来与分享意愿。公开能力仍关闭，本地路径修复不替代独立部署、启用、发布或验收。
