# v3.8.14 · Unified Initial + Follow-up Review

- Moved Follow-up template writing from Mail Monitoring into the first-class Mail Review workspace.
- Mail Monitoring now owns only mailbox facts, eligibility and prepared Follow-up task generation.
- Template-generated Follow-up tasks are no longer auto-confirmed or auto-queued.
- Mail Review now lists Initial and Follow-up tasks in one queue with source badges and unified Pass behavior.
- Follow-up Pass atomically confirms the current content version and queues it for Selection & Scheduling.
- Editing Follow-up recipient/subject/body invalidates the Pass and dequeues the task.
- Batch Pass supports mixed Initial + Follow-up selection.
- Follow-up can be reviewed even when a separate Initial import batch is still blocked in Import; unfinished Initial tasks remain hidden until their Import gate is complete.
- Existing unexecuted template-generated Follow-up tasks from v3.8.8–3.8.13 are migrated back to `prepared / awaiting-review`; older explicit manual confirmations retain their authorization semantics.
- Removed now-unused `confirmDerivedTask` and `queueDerivedTaskForDispatch` paths.
