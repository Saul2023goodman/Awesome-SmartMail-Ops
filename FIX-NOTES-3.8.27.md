# SmartMail Ops v3.8.27 — Compose Lifecycle + Pause Every Time

## Compose lifecycle

Batch execution no longer leaves one NetEase internal Compose tab behind for every task.

For each task the executor now:

1. opens the native NetEase Compose / Forward / Reply module;
2. captures the exact active `compose.ComposeModule` identity (`module.name`) in NetEase MAIN world;
3. fills recipients, subject, body, options, attachments and schedule;
4. waits for the existing provider save-success evidence;
5. removes that exact module with NetEase's own `$.MultiTab.remove(targetModule)`;
6. verifies the captured module has disappeared before the batch may continue.

The executor never closes `$.Context.module` blindly after save, because the operator may have changed the active NetEase tab.

If the provider has already removed the module, cleanup is treated as complete. If a saved draft cannot be safely cleaned up, the current task remains successful but the batch stops before the next task, preventing both duplicate retries and tab accumulation.

## Pause every time

Selection & Scheduling now has an optional `每封填写后暂停` mode. It is OFF by default and is runtime-only.

When enabled, each task pauses after all editable information, attachments and schedule have been populated but before `存草稿` is clicked. The NetEase dock expands into the execution panel and exposes `继续保存`. The operator can inspect the native Compose UI, then continue.

`当前封后停止` while paused requests batch stop and resumes the current task so that the already-prepared message can still be saved and cleaned up; no next task is started.

## Storage boundary

The new mode is not persisted. No business/task state was added to `chrome.storage`, IndexedDB or sessionStorage. Existing template/rule preferences remain the only intentional persistent settings.
