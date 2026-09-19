# SmartMail Ops — Current Architecture (v3.8.15)

## First-class workspaces

### 1. 导入资料 / Import

`Sources -> Normalize -> Duplicate Gate -> Attachment Preparation -> Ready Initial Tasks`

Import owns source recognition and the prevention of duplicate Initial outreach. Current-batch duplicates are resolved here; mailbox Draft hits are filtering facts; Sent history is an outbound-history gate. Provider Draft import is adoption of an existing mailbox object and bypasses new-mail dedupe.

### 2. 邮件审阅 / Review

`Ready Initial + Prepared Follow-up -> Audit / Correct -> Pass`

Review is the single content authorization boundary. It owns Initial message review, Follow-up template writing, Follow-up generated-draft review, correction, batch Pass, and exact-version authorization.

- Initial mail is exposed to Review only after its Import gate is complete.
- Follow-up may be reviewed independently of an unrelated unfinished Initial import batch.
- The Follow-up template stores only the middle body; salutation and signature come from the root Initial message.
- Template generation is preparation, not authorization.
- Follow-up Pass atomically confirms the current content version and queues the task for Dispatch.
- Editing a passed Follow-up invalidates the Pass and dequeues it.

### 3. 选择与排期 / Selection & Scheduling

`Passed Initial + Passed Follow-up -> Unified Queue -> Select -> Schedule -> Executor -> Draft Record`

This is the only execution-planning surface. A dispatch run freezes its executable keys before opening NetEase Mail. Failure stops the run; there is no blind continuation/retry. Draft creation is reconciled later against mailbox facts; Sent remains mailbox-authoritative.

### 4. 邮件监测 / Mail Monitoring

`Manual Mailbox Read -> Observations -> Reply Association -> Eligibility -> Prepared Follow-up Task`

Monitoring is operator-triggered. It owns mailbox facts, reply association, eligibility, Follow-up policy timing/attempt/mode settings, and single/batch creation of prepared Follow-up tasks. It does not own template writing, content Pass, scheduling, or execution.

## Follow-up path

`Sent Initial`

`-> manual mailbox read`

`-> reply / eligibility evaluation`

`-> template draft generation`

`-> Review Pass`

`-> Selection & Scheduling`

`-> NetEase native Forward / Reply / New draft`

`-> later mailbox reconciliation`

When root Initial body content is not cached, SmartMail reads NetEase MailReader's authenticated `readhtml` document and extracts the body from the complete `template#contentTemplate.content` DocumentFragment. `mbox:readMessage` is retained for provider message metadata/context, not as a speculative body source.

## Authority boundaries

- `operations.js`: durable mailbox facts, Follow-up policy/state, content-version and Review authorization state.
- `dispatch.js`: adapter from passed domain records into one executor-facing queue.
- `scheduler.js`: scheduling rules over that unified queue.
- `executor.js`: NetEase UI execution only; no Follow-up eligibility or content decisions.
- `app.js`: orchestration and first-class Import / Review / Dispatch / Monitoring UI.

## Follow-up state contract

Template generation creates:

- `state = prepared`
- `confirmedVersion = null`
- `reviewedAt = ''`
- `dispatch.queued = false`
- `dispatch.scheduleReason = awaiting-review`

Review Pass creates:

- `confirmedVersion = contentVersion`
- `confirmedAt = reviewedAt = now`
- `state = confirmed`
- `dispatch.queued = true`
- `dispatch.scheduleSource = review`
- `dispatch.scheduleReason = review-passed`

Any later change to Follow-up recipients, subject, body, or compose mode increments `contentVersion`, clears authorization, returns the task to `prepared`, and removes it from Dispatch.

## Upgrade behavior

Unexecuted Follow-up tasks created by the old template-auto-confirm path are migrated back to `prepared / awaiting-review`. Older Follow-up tasks that had an explicit human confirmation before template auto-confirm existed retain that confirmation as their Review authorization. Executed/sent history is never rewritten.


## v3.8.15 Review routing fix

The Review workspace resolves every visible card through the unified Review task registry (`reviewTaskByKey`) rather than the Initial-only `batch.tasks` collection. Follow-up cards therefore open the same first-class editor, remain navigable under search/filter changes, and refresh after content edits. Initial-only subject propagation helpers are explicitly disabled for Follow-up tasks.


## v3.8.18 Human-managed conversation boundary

A human reply is a terminal automation boundary for the same deterministic conversation, not merely a blocker relative to the most recent outbound. Conversation identity is derived without NLP from the exact normalized recipient set plus the normalized subject thread key (Re/Fw prefixes removed).

`human reply -> conversation becomes human-managed -> later operator Sent is recorded only -> no Follow-up timer restart`

Mail Monitoring collapses duplicate mailbox roots that belong to the same human-managed conversation into one operational row. A later message with a genuinely different normalized subject remains a separate outreach root. Automatic replies do not close automation; ambiguous replies remain reversible blockers. Any queued Follow-up that becomes human-blocked is removed from Dispatch.
