# SmartMail 邮件监测 / Follow-up（v3.8.2）

## 模块定位

“邮件监测”只负责读取和解释邮箱事实，并据此产生 / 更新 Follow-up 派生任务。它不再承担排期，也不直接创建网易草稿。

邮件监测采用人工唤醒：只有操作者点击“读取邮箱”或“完整读取”时，扩展才读取 163 的 Sent / Drafts / Inbox。其余时间只展示最近一次持久化快照。

## 主链路

1. 已发送邮件进入 `outboundRecords`。
2. SmartMail 创建的草稿在后续人工邮箱读取中与 Sent 对账；所有人工读取到的 Sent 若尚无 lineage，会自动建立 root lineage 并进入检测范围。不存在逐封“开始监测”的选择。
3. Inbox 消息进入 Reply Observation，并关联到对应 outbound lineage。
4. 回复分类为 `human / automatic / ambiguous / bounce / system`。
5. `automatic` 不阻断；`human` 阻断；`ambiguous` 阻断并等待人工判断。
6. Follow-up 到期后创建 Derived Task，不修改原始 Task / Sent Record。
7. Follow-up 在监测模块中准备正文并执行 exact-version confirmation。
8. 已确认的 Follow-up 通过“加入选择与排期”进入统一执行池；监测模块到此结束职责。
9. “选择与排期”统一汇合初始邮件与 Follow-up，负责选择范围、排期和执行。
10. 执行器根据 `composeMode` 使用网易原生 Forward / Reply / New 创建草稿。
11. Follow-up 草稿创建成功后从执行池退出，但不会被标记为 Sent。
12. 下一次人工读取邮箱时，Draft / Sent reconciliation 确认真实发送结果；确认 Sent 后下一轮从最近一次 outbound 重新计时。

## 自动检测范围 + 人工唤醒读取

- “是否检测”不是人工决策：Sent 一旦被读取进 operation store，就自动参与回复关联和 Follow-up eligibility。
- 暂停 Follow-up 只暂停生成新的跟进，不会停止该线程的回复事实读取。
- 不再联系仍由 recipient guard 作为硬阻断处理。


- 打开工作台：不读取邮箱。
- 打开“邮件监测”：不读取邮箱。
- 进入“选择与排期”：不读取邮箱。
- 点击“读取邮箱”：读取当前范围并更新事实。
- 点击“完整读取”：完整重建 Sent / Drafts / Inbox 邮箱事实。

因此 Follow-up eligibility 始终表示“基于最近一次人工读取快照的判断”，不是实时状态。

## 模块边界

### 邮件监测

拥有：邮箱读取、Sent/Draft/Inbox observation、reply association、eligibility、Follow-up 创建、内容准备、版本确认。

不拥有：执行范围选择、批量排期、草稿创建、自动发送。

### 选择与排期

拥有：统一执行池、选择/排除、排期规则、手工时间调整、网易草稿执行、失败即停。

输入来源：

- 已完成审阅的初始邮件 Task
- 已确认并显式加入执行池的 Follow-up Derived Task

### 批量草稿

拥有：资料导入、识别、查重、内容审阅、附件准备。完成后只把可执行初始邮件暴露给统一执行池。

## 安全边界

- Follow-up eligibility 不会自动入池，更不会自动执行。
- Follow-up 内容修改会使旧 confirmation 失效，并自动退出执行池。
- Human reply / ambiguous reply / recipient guard 是硬阻断。
- Forward / Reply 必须有原始 Sent provider message id。
- 执行失败不盲重试；统一执行器在当前失败项停止。
- 草稿创建成功 ≠ 已发送；Sent 只能由后续 mailbox reconciliation 确认。

## v3.8.8 template-driven generation

Follow-up generation no longer opens a per-task editor. Configure the reusable middle-body template once in Mail Monitoring. When a Follow-up becomes eligible, SmartMail uses the root Initial message as the personalization source, copies its salutation and signature block, inserts the saved template between them, confirms that deterministic result, and queues the Derived Task directly into Selection & Scheduling. Missing Initial body or missing salutation/signature causes that item to be skipped rather than guessed.
