# Photo Checkins

## Purpose

为当日习惯行动保留可选照片，支持在熟人约定中要求至少一张。上传与打卡分别确认，系统图片检查状态与完成状态分离，维持私密访问和当前账户事务可靠性，不将照片作为真实性认证。

## ADDED Requirements

### Requirement: Bounded private photo lifecycle

系统 SHALL 支持拍照/相册选取1—3张、压缩后每张不超过2MiB的照片，服务端核实上传文件与所属账户、代际、习惯和日期。文件私有存储，未绑定文件24小时后清理，绑定照片随本人记录保留。

#### Scenario: Forged reference or oversized file
- **WHEN** 客户端传入他人文件、其他日期文件或超过限制的图片
- **THEN** 拒绝确认或绑定，不改变打卡状态。

### Requirement: Atomic completion and required photo

系统 MUST 在完成事务中校验当天生效照片约定，并将完成与附件引用同事务提交；上传完成且元数据核实后允许提交，不等待监督人或异步图片检查。

#### Scenario: Old client without required photo
- **WHEN** 旧客户端提交需照片习惯的完成命令但未提供有效附件
- **THEN** 返回照片要求错误，不记为已完成。

#### Scenario: Upload confirmed but completion fails
- **WHEN** 上传成功但完成事务失败或回执不明
- **THEN** 页面不提前记为完成，保留本次会话输入并核对或用同一请求重试，不重复绑定。

### Requirement: Separate check and completion status

系统 SHALL 在云端确认打卡后显示已完成，图片处理中独立显示；仅图片检查pass后允许监督人读取，失败/review/risky不得展示，提供更换入口且不撤销已完成行动。

#### Scenario: Check pending or rejected
- **WHEN** 图片检查尚未完成、检查失败或不通过
- **THEN** 监督人只看到图片状态，完成统计保留且不触发未完成催促。

### Requirement: Preserve ordinary check-in and safe editing

系统 SHALL 保留普通一键打卡；必传照片才打开提交面板，当日已完成记录可添照片或更换。删除必传记录最后一张需明确确认并同事务撤销打卡，更换先保存新图。

#### Scenario: Last required photo removed
- **WHEN** 本人确认删除必传记录的最后一张
- **THEN** 同事务删除引用并撤销本次打卡，监督读取最新状态。

#### Scenario: Offline or account switched
- **WHEN** 断网、账户变化或跨日
- **THEN** 不将旧草稿保存到另一个账户/日期，不创建本机持久快照或离线队列。
