# SmartMail Follow-up Data Model v1

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
