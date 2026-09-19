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


## v3.8.2 Monitoring scope refinement

- Monitoring membership is no longer a user-selectable state.
- Every Sent record read from the mailbox automatically receives/retains a root lineage.
- Mail Monitoring continues to record mailbox facts even when Follow-up is paused.
- The operator controls Follow-up policy and exceptions, not whether an already-read Sent message is observed.
- The old manual adoption / unmonitored-outbound UI path has been removed.


## v3.8.3 Import owns duplicate verification

Duplicate verification is an intake/data-quality responsibility rather than a message-content review responsibility. The batch path is now:

`sources → classification/normalization → duplicate verification → clean tasks → mail review → dispatch`

Current-batch duplicate decisions are blocking at Import. Historical mailbox hits are evidence and warnings only. Mail Review no longer contains a duplicate decision mode.

## v3.8.4 Dedupe semantics

Import duplicate verification now protects the creation of **new Initial Tasks** across three evidence scopes: the current import batch, existing mailbox Draft records, and existing Sent records. Mailbox-history hits are explicit Import gates rather than passive hints.

Mailbox Draft import is a separate semantic path: it adopts provider drafts that already exist. Tasks with `sourceKind = mailbox-draft` bypass new-mail dedupe to avoid self-matching and accidental collapsing of legitimate provider drafts. Mailbox freshness remains manual through the Import action `读取最新邮箱` or the Mail Monitoring read actions.

For new Initial Tasks, Import requires at least one persisted complete manual mailbox snapshot before Mail Review can begin. If no snapshot exists, the operator must explicitly click `读取最新邮箱`; this does not reintroduce background monitoring. Mailbox-draft adoption bypasses this prerequisite together with duplicate checking.

## v3.8.5 Draft history is filtering, not comparison

Import-time duplicate handling now follows the business meaning of each evidence source:

`current batch duplicate → version choice`

`existing Draft only → compact filtering gate`

`existing Sent → outbound-history gate / Follow-up routing warning`

Draft-only hits never render imported body versus mailbox Draft body. They are shown as recipient-level Draft existence facts with a suggested filter-out action and an explicit keep exception. Sent history remains a stronger external communication fact and retains an explicit decision gate.
