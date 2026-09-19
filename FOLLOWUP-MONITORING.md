# SmartMail 邮件监测 / Follow-up（v3.7.0）

## 模块定位

“邮件监测”取代旧联系人工作区。它以已发送邮件事实为入口，在操作者主动唤醒时读取网易邮箱的 Sent / Drafts / Inbox，并用确定性规则维护 Follow-up 生命周期。

## 主链路

1. 已发送邮件进入 Outbound Records。
2. SmartMail 创建并发送的邮件在邮箱对账后自动进入监测；历史 Sent 可以手工“开始监测”。
3. Inbox 消息被记录为 Reply Observation，并尝试关联到对应 outbound lineage。
4. 回复分类为 human / automatic / ambiguous / bounce / system。
5. automatic 不阻断 Follow-up；human 阻断后续 Follow-up；ambiguous 阻断并要求人工判断。
6. Follow-up 到期后创建 Derived Task，而不是修改原邮件。
7. Derived Task 有独立 contentVersion / confirmedVersion；修改内容后必须重新确认。
8. 默认以网易原生 Forward 创建草稿，也支持 Reply / New。
9. Follow-up 草稿发送后，由 Sent mailbox reconciliation 确认并成为新的 outbound；下一轮从最近一次 outbound 重新计时。

## 人工唤醒读取

邮件监测采用按需读取，不运行后台轮询。只有操作者在“邮件监测”中点击“读取邮箱”或“完整读取”时，扩展才读取 163 的已发送、草稿和收件箱并更新本地 operation store。其余时间只展示上一次人工读取后保存的事实，不会周期访问邮箱，也不会因为进入批量流程而隐式刷新。

## 数据边界

- 业务事实：outboundRecords / draftRecords / inboundRecords / replyObservations / derivedTasks / recipientGuards / followUpPolicies
- 旧 Contact 不再是运行时业务对象。
- 旧 contacts storage 仅作为一次性迁移来源保留兼容读取。
- 名单中的“联系人”字段仍用于导入识别和查重，这不属于旧 Contact 模块。

## 安全边界

- Follow-up eligibility 不会自动发送邮件。
- Human reply / ambiguous reply / recipient guard 是硬阻断。
- Forward / Reply 必须有原始 Sent provider message id，避免伪造线程上下文。
- 执行失败不盲重试；等待重新对账或人工处理。
