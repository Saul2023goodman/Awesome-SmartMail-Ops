# SmartMail Ops v3.8.19 Storage Audit

## Product boundary

SmartMail is a runtime batch-execution tool, not a local business database.

Operational data is session-only and is discarded when the SmartMail app page is reloaded or closed. This includes:

- imported Initial tasks and Review state
- mailbox Sent / Draft / Inbox observations
- duplicate-check snapshots
- outbound / draft / reply records
- Follow-up eligibility and Derived Tasks
- Review pending/confirmed state
- Dispatch queue, selection and schedule overrides
- execution reconciliation and lineage
- per-conversation pause / reply disposition decisions

## Allowed persistent preferences

Only reusable tool preferences remain persistent through `localStorage`:

- Follow-up template body
- Follow-up global delay / max-attempt / compose-mode settings
- Follow-up template version metadata
- scheduling-rule preferences

These are configuration, not mail/task/history storage.

## Removed persistence

- Removed `chrome.storage.local` operations-store load/save.
- Removed the `storage` manifest permission.
- Removed the IndexedDB attachment vault and `file-vault.js`.
- Removed persisted schema/migration metadata.

## Attachment execution

Attachments remain only as browser `File` objects in the open SmartMail page. During execution they are streamed in chunks through a runtime Port to the 163 executor. No attachment bytes are written to IndexedDB or extension storage.

If the SmartMail page closes/reloads during execution, those runtime files disappear and the operator must reselect them.

## Follow-up Review lifecycle

Generated Follow-up tasks exist only in the current runtime store. They can appear in Review while the current SmartMail page remains open, but they do not survive reload/close and therefore cannot accumulate as a persistent backlog.

After a Follow-up draft is successfully created, it is no longer shown in Review because `draftPreparedAt` removes it from the current Review working set.
