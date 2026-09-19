# 3.6.0 Upgrade Notes

- Removed the Contacts navigation tab, Contact modal, Contact editing workflow, and `contacts.js` runtime module.
- Added `operations.js` as the operation-centric persistence/domain layer.
- Preserved current-batch duplicate detection and moved historical duplicate evidence to operation records.
- Added v3.5 legacy migration without recreating Contact entities.
- Added Follow-up policy, eligibility, reply evidence, derived-task lineage, exact content-version confirmation, and recipient guard primitives.
- Batch-created NetEase drafts now write `draftRecords` after the remote save is confirmed.
- A non-blocking quick mailbox read is attempted when entering selection/scheduling so historical duplicate evidence can refresh without restoring the Contact module.
- Full reply scanning and the Follow-up UI are intentionally not implemented in this step; the data model is ready for them.

## v3.7.0 — Mail Monitoring + Follow-up

- Added the production Mail Monitoring workspace; it replaces the old Contacts navigation surface.
- Added Inbox ingestion, deterministic reply observations, outbound/reply association, and manual resolution for ambiguous replies.
- Added background quick sync every five minutes while a logged-in 163 mailbox tab is available.
- Follow-up eligibility now produces derived tasks with independent version confirmation and lineage.
- Added native NetEase Forward / Reply context execution plus New message mode.
- Follow-up drafts are reconciled against Sent records so subsequent attempts restart from the latest outbound.
- Dedupe remains independent of the removed Contact runtime model.


## v3.7.2 — On-demand Mail Monitoring

- Removed the 5-minute background monitor and the `alarms` permission.
- Mailbox reads now happen only after an explicit operator action: “读取邮箱” or “完整读取”.
- Entering batch/review/dispatch flows no longer performs an implicit quick mailbox read.
- Follow-up eligibility uses the most recently persisted mailbox facts until the operator reads the mailbox again.


## v3.8.0 — Independent Selection & Scheduling / Unified Dispatch

- Promoted “选择与排期” from Batch step 3 to a top-level module.
- Reduced Batch to two responsibilities: import/preparation and review.
- Mail Monitoring no longer creates Follow-up drafts directly. It prepares and confirms Follow-up, then explicitly queues it for dispatch.
- Added `dispatch.js` to adapt reviewed initial mail and queued Follow-up into one execution-facing task shape.
- Added persisted `derivedTask.dispatch` state for Follow-up queue membership, selection and scheduling.
- Editing Follow-up content invalidates confirmation and automatically removes it from the dispatch pool.
- The unified executor now freezes the selected queue at run start and executes initial mail and Follow-up through the same path.
- Follow-up execution uses native Forward / Reply / New context, writes a draft record, updates the derived task, and dequeues it without falsely marking it Sent.
- Follow-up-only operation is supported: Selection & Scheduling no longer depends on an active Batch.
- Mailbox observation remains operator-triggered; entering Dispatch does not read the mailbox.
