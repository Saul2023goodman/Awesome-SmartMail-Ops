# v3.8.94 — Batch handoff latency root fix

## Root cause
Batch runtime transitions (`running` / `done`) called `scheduleBatchRender({force:true})`. `scheduleBatchRender()` also scheduled `scheduleWorkspacePersist()` with a 220 ms debounce. In standard dispatch the post-mail delay was 300 ms, so after a mail was already saved the persistence timer reliably fired before the next mail. On large workspaces this synchronously cloned/serialized the complete imported dataset and task edit state, then wrote it to `chrome.storage.local`. The full planning matrix was also rebuilt for every runtime transition. The apparent provider delay was therefore local UI/storage work on the app main thread.

## Fix
- Workspace persistence is suppressed while `batch.running`; editable planning controls are locked, so runtime state has no durable workspace data to persist.
- Runtime status changes patch only the matching planning row (`执行中` / `已完成` / restored ready state).
- Full planning-matrix render + workspace persistence occurs once after the batch ends.
- Existing task controls are disabled directly at batch start instead of requiring a full render.
- Removed the old 300/60 ms fixed post-mail sleep; after exact Compose cleanup only a 24 ms event-loop yield remains. `openFreshCompose()` remains the provider readiness/freshness gate.
- Promotion MutationObserver is stopped immediately after save confirmation, before Compose teardown.

No success evidence, attachment verification, schedule confirmation, exact Compose cleanup, duplicate safety, or failure-stop behavior was weakened.
