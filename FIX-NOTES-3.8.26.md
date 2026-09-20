# SmartMail Ops v3.8.26 — Minimal Mailbox Launcher

## Dock hierarchy

The NetEase mailbox dock is no longer a second navigation system.

### Level 1 — always available

Only two concerns remain:

- current NetEase connection/account state;
- one direct entry to SmartMail Ops.

The old `作业 / 监测 / 执行 / 状态` tabs, workflow menu, explanatory copy and compose shortcut were removed from the mailbox overlay.

### Level 2 — execution context only

The secondary surface exists only when an execution state exists. It shows:

- progress;
- current recipient/subject;
- the current execution message;
- stop-after-current and open-dispatch actions.

Execution start/error/finish can surface this compact monitor automatically. Outside execution, the dock returns to the single connection/launch row.

## Navigation correction

`background.js` now accepts `review` as an application deep-link target. The previous dock exposed a Review route even though `normalizeAppTarget()` silently rewrote it to `batch`.

## Product principle

The mailbox extension surface is now a connection-aware launcher plus an execution monitor. Business navigation lives only in the SmartMail app.
