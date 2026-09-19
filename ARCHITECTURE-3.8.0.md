# SmartMail Ops v3.8.0 Architecture

## Three top-level operational modules

### 1. 批量草稿 / Batch Preparation

`Sources -> Normalize -> Duplicate Check -> Review -> Ready Initial Tasks`

The module prepares initial outreach. It does not own scheduling or execution anymore.

### 2. 邮件监测 / Mail Monitoring

`Manual Mailbox Read -> Observations -> Reply Association -> Eligibility -> Follow-up Derived Task -> Prepare -> Confirm -> Queue`

The module owns mailbox facts and Follow-up decisions. It never calls the executor directly.

### 3. 选择与排期 / Selection & Scheduling

`Reviewed Initial Tasks + Queued Follow-up -> Unified Queue -> Select -> Schedule -> Executor -> Draft Record`

This is the only user-facing execution module.

## Execution contracts

- Initial mail enters the pool only after Batch handoff is complete.
- Follow-up enters only after its current `contentVersion` is confirmed and the operator clicks “加入选择与排期”.
- Editing a queued Follow-up automatically dequeues it.
- Selection and schedule edits for Follow-up are persisted under `derivedTask.dispatch`.
- A dispatch run freezes its executable keys before opening NetEase Mail.
- Failure stops the run; no blind continuation/retry.
- Draft creation is reconciled later against mailbox facts. Sent remains mailbox-authoritative.

## Authority boundaries

- `operations.js`: durable operational facts and Follow-up domain state.
- `dispatch.js`: pure adapter from domain records to executor-facing unified queue.
- `scheduler.js`: scheduling rules over the unified queue.
- `executor.js`: NetEase UI execution only; no Follow-up business decisions.
- `app.js`: orchestration/UI; Mail Monitoring cannot bypass Dispatch.
