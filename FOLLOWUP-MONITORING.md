# SmartMail 邮件监测 / Follow-up（v3.8.20）

## 模块定位

“邮件监测”只负责人工读取并解释邮箱事实、判断 Follow-up eligibility，以及按已保存模板生成 Follow-up Derived Task。生成结果随后走与 Initial 相同的 Review classifier：完整项自动通过，异常项进入“需处理”。

邮箱读取仍采用人工唤醒：只有操作者点击“读取邮箱”或“完整读取”时，扩展才访问 163 的 Sent / Drafts / Inbox；其余时间只使用当前打开页面内存中的最近一次读取结果。

## 当前主链路

1. Sent 进入 `outboundRecords`，并自动建立/保留 root lineage。
2. Inbox 进入 reply observation，并关联到对应 outbound lineage。
3. 回复分类为 `human / automatic / ambiguous / bounce / system`。
4. `human` 和 `ambiguous` 阻断新的 Follow-up；`automatic` 不阻断。
5. 到期线程可单条或批量生成 Follow-up Task。
6. 若 root Initial 正文尚未缓存，按 provider message id 读取网易 `readhtml` 文档，并从完整的 `template#contentTemplate.content` DocumentFragment 获取真实正文。
7. 从 root Initial 提取称呼与署名，组合为 `Initial 称呼 + Follow-up 模板正文 + Initial 署名`。
8. 生成后立即运行统一 Review classifier：收件人、主题规则、正文和 blocker 均正常时自动确认当前 content version 并进入“选择与排期”。
9. 只有异常或之后被 operator 修改的 Follow-up 才停留在“邮件审阅 → 需处理”，由人工确认当前版本。
10. Dispatch 使用网易原生 Forward / Reply / New 创建普通或定时草稿。
11. 草稿创建成功仍不等于 Sent；后续再次人工读取邮箱进行 reconciliation。

## 模块边界

### 邮件监测

拥有：人工邮箱读取、Sent/Draft/Inbox facts、reply association、eligibility、批量生成 Follow-up runtime task。

不拥有：模板撰写、内容 Pass、排期、草稿创建。

### 邮件审阅

拥有：Initial 与 Follow-up 的统一内容核验。Follow-up 模板正文也在这里维护；模板只影响之后新生成的任务。

Review 的目的不是逐封审批。确定性检查完整的 Follow-up 自动记录 `reviewDecision = auto` 并入 Dispatch；异常项或 operator 修改后的版本才需要人工确认，人工确认记录 `reviewDecision = manual`。任何后续内容修改都会增加 content version、清除旧 Review decision 并自动退出执行池。

### 选择与排期

只接受已经通过 Review 的 Initial / Follow-up，负责范围选择、排期和网易执行。

## 安全边界

- 模板生成本身不是理由；只有模板输出通过统一确定性 Review classifier 才会自动入池。
- Human reply / ambiguous reply / recipient guard 仍是硬阻断。
- Forward / Reply 需要原始 Sent provider message id。
- 执行失败停止，不盲重试。
- Draft success ≠ Sent；Sent 由邮箱事实确认。


## v3.8.18 有效回复后的人工沟通

有效回复现在是 conversation 级别的自动化终止条件。conversation 使用确定性键：标准化后的完整收件人集合 + 去除 Re/Fw 等前缀后的主题。

- 同一 conversation 一旦出现 `human` reply，之后 operator 手工发送的 Sent 继续被读取并记录，但不会创建新的自动 Follow-up root，也不会重启 delay 计时。
- 邮件监测会把同一已回复 conversation 下历史上被误拆成多个 mailbox root 的记录折叠为一行，最近人工 Sent 显示为“人工沟通”。
- 已经生成但尚未执行的 Follow-up 会被阻断；若已进入 Dispatch，会自动退池。
- `automatic` reply 不终止 Follow-up；`ambiguous` 仍保持可人工改判的阻断。
- 新的规范化主题仍视为新的 outreach，不继承旧 conversation 的有效回复终止状态。


## v3.8.19 运行时工作集

Follow-up 不再是持久化待办。每次人工读取邮箱后，在当前页面内生成本次工作集；模板生成的 Follow-up 只在本次会话进入邮件审阅和选择与排期。关闭/刷新 SmartMail 后，Follow-up Task、回复 observation、mailbox snapshot 与排期状态全部清空。模板与全局规则属于工具设置，可跨会话保留。


## v3.8.20 统一自动审阅

Follow-up 不再默认逐封 Pass。模板生成后，系统使用与 Initial 相同的“正常自动通过、异常人工处理”原则：

`模板生成 -> deterministic Review classifier -> 自动通过/进入排期 OR 需处理/人工确认`

自动通过仍然记录 exact content version；operator 后续编辑会使该自动通过立即失效并退回“需处理”。


## v3.8.54 自动回复识别

Follow-up 的“已回复”指**有效回复**。自动回复在事实层仍被记录，但逻辑上等同于未回复，不暂停 Follow-up。

确定性识别信号包括：网易自动回复/休假/OOO flags、Automatic Reply / Auto Response / Out of Office 等主题、自动应答型发件人、可用的列表正文摘要中的 OOO/leave 文案，以及直接关联到刚发邮件且 3 分钟内返回的快速回复。

3 分钟规则属于启发式：默认作为 auto-reply feature 非阻断处理；人工可以将误判直接改为“计为已回复”。人工判定优先于后续自动 reconciliation。


## v3.8.55 已回复即转交人工

Auto-reply 不再作为与“已回复”并列的用户状态，而只是判断入站邮件是否构成有效回复的一项 feature。邮件监测的主语义只有“未回复 / 已回复”：自动回复 feature 仍按未回复处理；有效回复则进入“已回复”。

一旦进入“已回复”，SmartMail 的批量自动化职责结束：停止该 conversation 的后续 Follow-up，提示“有效回复，需要人工回复”，并只提供“前往邮箱”。该按钮直接打开对应的网易入站邮件，后续高度定制的交流由操作者在邮箱中完成。SmartMail 不提供已回复后的批量 Reply 流程。
