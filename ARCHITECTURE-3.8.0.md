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

- `operations.js`: runtime mailbox facts, Follow-up policy/state, content-version and Review state for the current open SmartMail session.
- `dispatch.js`: adapter from passed domain records into one executor-facing queue.
- `scheduler.js`: scheduling rules over that unified queue.
- `executor.js`: NetEase UI execution only; no Follow-up eligibility or content decisions.
- `app.js`: orchestration and first-class Import / Review / Dispatch / Monitoring UI.

## Follow-up state contract

Template generation and Review now use the same rule as Initial mail: complete deterministic output auto-passes; only exceptions require operator confirmation.

A complete generated Follow-up creates:

- `state = confirmed`
- `confirmedVersion = contentVersion`
- `confirmedAt = reviewedAt = now`
- `reviewDecision = auto`
- `dispatch.queued = true`
- `dispatch.scheduleSource = review-auto`
- `dispatch.scheduleReason = review-auto-passed`

If a generated task is missing a required field or otherwise fails the deterministic Review classifier, it remains `prepared / awaiting-review` and appears under Review → 需处理. Manual confirmation uses `reviewDecision = manual` and `scheduleReason = review-passed`.

Any later operator change to Follow-up recipients, subject, body, or compose mode increments `contentVersion`, clears the previous auto/manual Review decision, returns the task to `prepared`, and removes it from Dispatch until the edited version is confirmed.


## v3.8.15 Review routing fix

The Review workspace resolves every visible card through the unified Review task registry (`reviewTaskByKey`) rather than the Initial-only `batch.tasks` collection. Follow-up cards therefore open the same first-class editor, remain navigable under search/filter changes, and refresh after content edits. Initial-only subject propagation helpers are explicitly disabled for Follow-up tasks.


## v3.8.18 Human-managed conversation boundary

A human reply is a terminal automation boundary for the same deterministic conversation, not merely a blocker relative to the most recent outbound. Conversation identity is derived without NLP from the exact normalized recipient set plus the normalized subject thread key (Re/Fw prefixes removed).

`human reply -> conversation becomes human-managed -> later operator Sent is recorded only -> no Follow-up timer restart`

Mail Monitoring collapses duplicate mailbox roots that belong to the same human-managed conversation into one operational row. A later message with a genuinely different normalized subject remains a separate outreach root. Automatic replies do not close automation; ambiguous replies remain reversible blockers. Any queued Follow-up that becomes human-blocked is removed from Dispatch.
## v3.8.19 runtime-only product boundary

SmartMail no longer persists operational/mailbox/task state. The current app page owns an in-memory working set only: imports, mailbox observations, dedupe facts, Follow-up Derived Tasks, Review state and Dispatch state disappear when the page is closed or reloaded. Only reusable tool preferences (Follow-up template/global rules and scheduling rules) persist. Attachments are streamed from in-memory `File` objects during execution and are not stored in IndexedDB.

This changes Follow-up from a durable queue into a current-session batch: manual mailbox read → generate candidates → Review → Dispatch → create drafts. A new app session starts with no operational history and requires a new operator-triggered mailbox read.



## v3.8.20 Unified auto-review

Initial and Follow-up now share the same Review intent: detect exceptions, not force per-message approval. Deterministically complete Follow-up template output is auto-reviewed and queued immediately; only missing/invalid fields, blockers, or operator-edited versions require manual confirmation. Review remains the common visibility surface for both auto-passed and exception items.

## v3.8.21 Continuous Review surface

Review is a continuous batch-reading surface rather than a per-message navigation state. Initial and Follow-up tasks are rendered as vertically stacked complete-mail sheets in one scroll container. Review remains an exception-detection gate: operators scan the batch, use search/status filters, and open the focused correction editor only when a specific message needs modification. Navigation from Monitoring targets and scrolls to a sheet; it does not create a single-message Review mode.

## v3.8.22 Review interaction refinement

Review now has two reading surfaces over the same runtime task set. The default `board` surface is the high-density card grid used to scan status and exceptions. Opening a card switches to `preview`, a vertically continuous reader over the current filtered set and scrolls to the selected mail. Preview keeps semantic key-information highlighting inline in the full message and does not create detached opening/closing excerpts. Editing remains an explicit correction action layered over Preview; it is not the default way to read a mail.


## v3.8.23 Preview sidebar navigation

The card grid remains Review's default high-density surface. Opening a card enters the continuous Preview reader with a persistent left navigation rail inspired by document-preview applications. The rail reuses the compact Review-card language (index, Initial/Follow-up kind, recipient identity, subject and state) rather than introducing a separate information model.

The Preview reader and rail are bidirectionally synchronized: selecting a rail card scrolls the full-mail reader to that message, while scrolling the reader updates the active rail card and keeps it visible. Motion is intentionally restrained: the rail and first visible pages ease into place on entry, active cards use small positional/elevation transitions, and `prefers-reduced-motion` disables the motion layer. Semantic key-information markers remain inline in the full body; opening/closing excerpts are not rendered separately.
