# SmartMail 邮件监测 / Follow-up（v3.8.14）

## 模块定位

“邮件监测”只负责人工读取并解释邮箱事实、判断 Follow-up eligibility，以及按已保存模板生成 **待审阅** 的 Follow-up Derived Task。它不拥有内容授权、排期或执行。

邮箱读取仍采用人工唤醒：只有操作者点击“读取邮箱”或“完整读取”时，扩展才访问 163 的 Sent / Drafts / Inbox；其余时间只使用上一次持久化快照。

## 当前主链路

1. Sent 进入 `outboundRecords`，并自动建立/保留 root lineage。
2. Inbox 进入 reply observation，并关联到对应 outbound lineage。
3. 回复分类为 `human / automatic / ambiguous / bounce / system`。
4. `human` 和 `ambiguous` 阻断新的 Follow-up；`automatic` 不阻断。
5. 到期线程可单条或批量生成 Follow-up Task。
6. 若 root Initial 正文尚未缓存，按 provider message id 读取网易 `readhtml` 文档，并从 `template#contentTemplate > [data-ntes="ntes_mail_body_root"]` 获取真实正文。
7. 从 root Initial 提取称呼与署名，组合为 `Initial 称呼 + Follow-up 模板正文 + Initial 署名`。
8. 生成结果仅为 `prepared` Follow-up，不确认、不入执行池。
9. Follow-up 出现在一级“邮件审阅”中；人工 Pass 后才确认当前 content version 并进入“选择与排期”。
10. Dispatch 使用网易原生 Forward / Reply / New 创建普通或定时草稿。
11. 草稿创建成功仍不等于 Sent；后续再次人工读取邮箱进行 reconciliation。

## 模块边界

### 邮件监测

拥有：人工邮箱读取、Sent/Draft/Inbox facts、reply association、eligibility、批量生成 Follow-up prepared task。

不拥有：模板撰写、内容 Pass、排期、草稿创建。

### 邮件审阅

拥有：Initial 与 Follow-up 的统一内容核验。Follow-up 模板正文也在这里维护；模板只影响之后新生成的任务。

Follow-up Pass 是授权边界：Pass 时确认当前 `contentVersion`，写入 `reviewedAt`，并将该 task 加入统一 Dispatch queue。修改 Follow-up 的收件人、主题或正文会增加 content version、清除 Review Pass 并自动退出执行池。

### 选择与排期

只接受已经通过 Review 的 Initial / Follow-up，负责范围选择、排期和网易执行。

## 安全边界

- 模板生成不是授权。
- Human reply / ambiguous reply / recipient guard 仍是硬阻断。
- Forward / Reply 需要原始 Sent provider message id。
- 执行失败停止，不盲重试。
- Draft success ≠ Sent；Sent 由邮箱事实确认。
- 旧版“模板生成后自动 confirmed + queued”的未执行任务升级后会退回 `prepared / 待审阅`。旧版明确人工确认过的 Follow-up 保留其人工授权语义。
