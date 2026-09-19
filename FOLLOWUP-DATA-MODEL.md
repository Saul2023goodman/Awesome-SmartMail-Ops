# SmartMail Follow-up Data Model v2 (v3.8.0)

Version 3.6.0 removes the legacy Contact/CRM aggregate from runtime behavior. Follow-up is modeled from operational facts instead of a `contact.followUp` flag.

## Core records

### outboundRecords
Immutable mailbox-side sent facts. A record can later be linked to a task with `taskId`, `rootTaskId`, `parentOutboundId`, and `sequence`.

- `kind`: `unlinked | initial | follow_up`
- `status`: normally `sent`
- `recipients[]`
- `subject`
- `sentAt`
- provider identity and mailbox observation metadata

### draftRecords
Draft/preparation facts. Drafts created by the current batch executor are recorded immediately after NetEase confirms the draft was saved.

### replyObservations
Evidence about inbound replies. The data model supports:

- `human`
- `automatic`
- `ambiguous`
- `bounce`
- `system`

Automatic replies do not block Follow-up. Human replies and ambiguous replies are hard blockers until resolved.

### derivedTasks
Follow-up is a derived Task, not a contact state.

Important fields:

- `kind = follow_up`
- `rootTaskId`
- `parentTaskId`
- `parentOutboundId`
- `sequence`
- `state = due | prepared | confirmed | scheduled | sent | blocked | cancelled`
- `contentVersion`
- `confirmedVersion`
- `composeMode = forward | reply | new`

Changing Follow-up content increments `contentVersion` and invalidates the previous confirmation.

Each Follow-up also owns a `dispatch` envelope rather than execution fields being mixed into mailbox state:

- `queued`: explicitly entered the unified Selection & Scheduling pool
- `enabled`: selected for the current execution range
- `scheduleAt`
- `scheduleSource`
- `scheduleReason`
- `queuedAt` / `dequeuedAt` / `dequeuedReason`

Editing Follow-up content after confirmation automatically clears `dispatch.queued`, so an obsolete approved version cannot remain executable.

### recipientGuards
Safety/operational constraints only. This is not a Contact entity.

- `paused`
- `do-not-contact`

The legacy v3.5 contact policy is migrated here so old stop rules are not silently lost.

### followUpPolicies
Default policy plus per-root-task overrides.

Default values in v1:

- enabled: true
- delayDays: 7
- maxAttempts: 2
- composeMode: forward

## Eligibility

A Follow-up is eligible only when:

1. A linked sent outbound exists for the root task.
2. Follow-up is enabled.
3. The recipient is not paused / do-not-contact.
4. No human reply exists after the latest outbound.
5. No ambiguous reply exists after the latest outbound.
6. Maximum attempts have not been reached.
7. The same sequence has not already produced a live derived task.
8. The delay has elapsed, unless a manual early Follow-up is explicitly requested.

The clock always starts from the latest outbound, so FU2 is calculated from FU1 rather than from the initial email.

## Legacy migration

The old `nmda.contacts.v1:*` key is read only as a migration source when no operations store exists yet. The old key is retained for rollback but is no longer a runtime dependency.

Migrated data:

- verifiable sent history -> `outboundRecords`
- verifiable draft history -> `draftRecords`
- Pause / Do Not Contact -> `recipientGuards`

Not migrated as domain state:

- contact stage
- `followUp: boolean`
- contact-level counters
- contact-level tags

## Duplicate checking

Duplicate checking remains independent of the removed Contact module:

- current-batch exact email duplicates: `roster.js`
- probable name + institution duplicates: `roster.js`
- historical mailbox hits: `outboundRecords` / `draftRecords`



## Mailbox observation cadence

Mailbox observation is operator-triggered. The data model stores the latest observed facts and their timestamps; it does not assume continuous or periodic monitoring. Follow-up eligibility is recalculated against the latest persisted snapshot when the operator reads the mailbox.


## Unified dispatch boundary (v3.8.0)

`derivedTasks` never call the NetEase executor directly. A confirmed Follow-up must first be explicitly queued. `dispatch.js` adapts queued Follow-up tasks and reviewed initial tasks into one executor-facing shape.

The unified queue is ephemeral at render time; authoritative Follow-up dispatch intent stays in `derivedTasks[*].dispatch`, while initial batch selection continues to use the batch task edit state.

After a Follow-up draft is successfully created, SmartMail records a `draftRecord`, writes `draftPreparedAt` / `draftRecordId` to the derived task, and removes it from the dispatch pool. A scheduled draft may move the derived task to `scheduled`; an unscheduled prepared draft remains confirmed. Neither is considered sent until later mailbox reconciliation.

## v3.8.14 template generation + Review gate

The reusable `templateBody` is still versioned, but template generation is preparation rather than authorization. New Follow-up tasks are created with:

- `state = prepared`
- `confirmedVersion = null`
- `reviewedAt = ''`
- `dispatch.queued = false`
- `dispatch.scheduleReason = awaiting-review`

The generated body remains deterministic:

`Initial salutation + templateBody + Initial signature`

Each task records `generatedFromTemplateVersion` and the personalization snapshot used. Review Pass atomically sets `confirmedVersion = contentVersion`, records `confirmedAt / reviewedAt`, changes `state` to `confirmed`, and queues the task with `scheduleSource = review` / `scheduleReason = review-passed`.

Editing recipients, subject, body or compose mode after Pass increments `contentVersion`, clears `confirmedVersion / reviewedAt`, returns the task to `prepared`, and dequeues it. This makes Review the single content authorization boundary for both Initial and Follow-up mail.
