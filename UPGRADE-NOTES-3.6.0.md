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
