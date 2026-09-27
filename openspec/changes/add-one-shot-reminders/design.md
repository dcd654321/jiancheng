# Design

## Scheduling

请求字段白名单，身份/epoch/限流校验后点读主账户。三个北京时间时段 08:00、12:30、20:30，从今天向后最多 7 天找有安排且时段尚未来临的日期。预览含源 revision、businessDate、dueAt、generation 和随机 operationId；授权后按原预览确认，计划或日期变化必须重新预览。

文档 ID=sha256(owner:epoch:businessDate)。pending 同日不允许另开；cancelled 只接受新操作号和准确 generation（最多 8 次），已 claimed/sent/failed/unknown 不可再安排。历史 operationId 保存在小型回执中，重放只返回原安排的当前状态，不复活已取消提醒。客户端 accept 只是用户授权报告，不能当作平台额度凭证。

## Dispatch

队列按 status+dueAt 查询，每批最多 20，处理时间有界；事务从 pending 改 claimed 后才执行外部动作。发送前重新点读当前 epoch、清理状态、同日、15 分钟有效窗口及今日未完成任务。过期、全做完、取消、删除不发。

调用外部平台最多一次，返回成功只标平台已接受。超时/不确定错误标 unknown；认领后进程崩溃，后续调度将过期 claimed 转 unknown，不重新认领。平台已接受但落库失败可能保持 claimed，仍不重发。认领后用户取消显示正在处理，不虚报可撤回已经在途的发送。

## Security and cost

不能仅凭 event.Type=Timer 认证。使用服务端/定时器私有配置的 256 位随机凭据 constant-time 比较，同时核对固定触发器名且拒绝微信用户上下文；禁止客户端/HTTP公开调用权限。自定义 Message 的 SCF 支持参见 https://cloud.tencent.com/document/product/583/9708 ，在本共享环境是否支持须实际核验，不可用就不启用。

不输出事件、令牌、OpenID 或平台错误。接收者 AES-256-GCM 加密，AAD 绑定任务 ID/owner/epoch，密钥只在服务端环境；部署者轮换前必须完成/取消旧 pending。模板字段由服务端严格配置为合规模板的 thing/number/time 字段；内容仅固定说明和真实待做数，不含私人习惯名称。

独立全局发送额度，默认停发；提醒记录 14 天 TTL 为部署门禁（SDK Date 字段）。客户端展示只保留近期及未来记录。未部署 TTL/索引、未验证个人主体模板/共享发送归属/真实授权/时区/平台预算时不得启用。

## Compatibility

模板 ID 前后端一致并由服务端预览返回；不把私有密钥打包。提醒失败不影响打卡。账户删除前置 tombstone 立即阻止新发送，已在途平台调用不可撤回。提醒数据物理清理由既有旁路清理覆盖。
