# SmartMail Ops v3.8.31 — Automatic Mailbox Sync Motion

## Behavior change
- Mailbox facts are now read automatically instead of depending on page-specific “读取邮箱” actions.
- Opening SmartMail / reconnecting an authenticated NetEase mailbox starts a quick sync automatically.
- Switching among Import, Review, Dispatch and Monitoring refreshes mailbox facts on demand with a 30-second freshness window, avoiding redundant requests on rapid navigation.
- Importing new Initial outreach automatically triggers the stronger dedupe read of Sent + Draft history before the duplicate gate is considered complete.
- Importing the Draft mailbox as a source remains an explicit user action because that operation replaces the current import dataset.

## Shared motion
- Added one persistent mailbox-sync rail in the global header, so every workspace page sees the same state instead of carrying a separate loading treatment.
- `syncing`: three mailbox fact nodes pulse in sequence while a runner travels across the rail.
- `success`: all nodes settle into the completed state, then the rail returns to quiet “自动同步”.
- `waiting`: indicates that mailbox connection/login is required before automatic reading can start.
- `error`: shows a quiet recoverable warning; automatic navigation sync can retry later.
- Import duplicate-gate waiting state gets a subtle sweep while mailbox history is being fetched.
- `prefers-reduced-motion` is respected.

## Manual controls
- Normal workflow no longer requires manual mailbox reading.
- “立即刷新”, “完整重读”, and Import “重新核验” remain as quiet recovery / force-refresh controls.
- “读取草稿箱” remains explicit because it is a data-import action, not background synchronization.

## Data-safety rule
Automatic synchronization only reads mailbox facts. It does not automatically replace the current import dataset, send mail, or mutate mailbox messages.
