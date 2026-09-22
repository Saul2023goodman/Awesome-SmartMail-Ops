# SmartMail Ops · Product UI structural audit (v3.8.108)

This revision treats product language as part of the information architecture, not as a copy-polish pass.

## 1. Product model

The interface now has two explicit layers:

- **流程**: 准备邮件 → 审阅邮件 → 安排发送
- **运营**: 成效 / 工具

“邮件监测”和“极速附件” are therefore represented by structure as peer tools. The UI no longer explains that they are “independent capabilities”, that future tools should stay “at the same level”, or that they should not be “squeezed into” other pages. Those are implementation decisions, not operator-facing content.

## 2. Tool architecture

The former utility area has been rebuilt as a real tool hub:

- only currently usable tools are shown;
- roadmap placeholders such as **COMING NEXT / EXTENSION SLOT / 待开发功能 / 能力位** are removed;
- each tool card answers three user questions: **what is this / what can I do / where do I go next**;
- future tools can be added as peer cards without changing the core mail flow.

## 3. Operator vocabulary

The primary UI now uses stable product objects:

- 初始邮件 / 跟进邮件
- 联系人
- 草稿
- 附件
- 发送时间
- 待发送邮件
- 已就绪 / 已检查 / 需要处理

Implementation concepts such as **执行池, Compose, native/original engine, provider message id, derived task, runtime file, read-back verification, clone/swap transaction, cache/workset** are kept out of ordinary operator surfaces.

## 4. State is not a business tag

Follow-up state is no longer injected into the task's business-tag collection. The UI now keeps two concepts separate:

- **business tags**: operator-defined classification;
- **mail lifecycle state**: initial/follow-up, review readiness, scheduling and delivery state.

This prevents system state from appearing as if it were user taxonomy.

## 5. Technical failure boundary

Execution and mailbox internals still keep detailed diagnostics in code/logs, but normal UI feedback is phrased around the failed object and the next safe action. Examples:

- “provider message id missing” → “无法定位对应的原邮件，请刷新邮件监测后重试”
- Compose/native-engine progress → “正在填写…” / “已切换为标准创建模式”
- read-back verification → “正在核对草稿内容”

## 6. Attachment update model

“极速附件” exposes one user-legible safety sequence:

**读取原稿 → 创建新稿 → 更新附件 → 核对内容 → 完成替换**

Internal clone/read-back/swap mechanics remain implementation details.

## 7. Destructive action model

The global reset is expressed as **重新开始**. The confirmation dialog states what work content will be cleared and what NetEase mailbox content will remain, instead of describing local storage/cache mechanics.

## Product-language rule

A normal operator-facing surface should explain only **object, state, action, consequence, next step**. Component hierarchy, future development plans, DOM/API routes, storage ownership and execution architecture belong in implementation documentation or diagnostics, not in primary UI copy.
