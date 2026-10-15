# Friend Supervision

## Purpose

让用户选择一个熟人共同关注指定习惯，在双方确认的期限内查看行动状态与允许展示的照片，并可随时结束。监督关系不开放其他习惯、私人备注或生效前内容，监督人无需审核打卡。

## ADDED Requirements

### Requirement: Explicit single-habit agreement

系统 SHALL 为每个习惯建立最多一位有效监督人的约定，邀请48小时有效，接受后由本人确认申请者；期限为7/14/30天，默认7天，截止默认21:00，照片默认选填。

#### Scenario: Invitation forwarded
- **WHEN** 邀请被转发且他人申请
- **THEN** 申请者未获本人确认前无法读取记录或照片，本人可识别申请并选择是否确认。

#### Scenario: Duplicate or expired invitation
- **WHEN** 邀请过期、重复申请或该习惯已有监督人
- **THEN** 返回明确状态，确认重试不建立第二条有效关系。

### Requirement: Scoped account-isolated reading

系统 SHALL 在每次读取时核验当前平台身份、双方账户代际、关系期限与具体习惯；只返回生效后的状态及允许的照片，不返回其他习惯或私人备注。

#### Scenario: Unauthorized account or earlier record
- **WHEN** 非关系成员读取，或读取关系生效前的内容
- **THEN** 拒绝内容访问，不签发照片链接。

#### Scenario: Already completed on the confirmation day
- **WHEN** 确认约定时该习惯当天已经完成
- **THEN** 约定从明天开始并按所选期限计算结束日，今天已有记录和照片不开放，尚未开始的约定仍占用该习惯唯一监督名额。

### Requirement: Manage agreement and encouragement

系统 SHALL 支持本人修改截止与照片规则，修改从次日生效；双方可立即结束监督，到期不自动续约。监督人只可对已完成记录给予一次固定站内鼓励，不决定完成状态。

#### Scenario: Rule change on completed day
- **WHEN** 当天更改照片要求或截止时间
- **THEN** 今天和历史按原规则判断，明天起采用新规则。

#### Scenario: Relationship ended or account deleted
- **WHEN** 一方结束关系或删除账户
- **THEN** 后续读取和提醒立即失效，旧图片链接最长5分钟失效，本人原有打卡保留直到本人删除。

### Requirement: Low-effort supervision views

系统 SHALL 保留三Tab导航，在我的提供双向监督列表，在存在有效关系时提供今日紧凑入口；按已过截止待做、截止前待做、已完成排序，今日无需完成单独标明。

#### Scenario: Rest day and minimum completion
- **WHEN** 当天没有安排或本人完成忙时目标
- **THEN** 分别显示无需完成或已完成，不误标为漏打卡，不要求监督人审批。
