# v3.8.2 — Monitoring Logic & UI Refactor

- Replaced the broken expandable “Follow-up 规则” panel with a compact always-visible rule bar.
- Removed manual “开始监测 / 暂停监测 / 尚未纳入监测” workflow.
- All Sent records discovered by an explicit mailbox read are automatically placed in monitoring scope.
- Pausing Follow-up now means only “do not create new Follow-up”; mailbox facts and replies are still observed on the next manual read.
- Removed the production manual-adoption API path from `operations.js`.
- Kept manual mailbox reads: there is still no background polling.
- Compressed monitoring metrics and row spacing to reduce vertical usage.
- Selection & Scheduling architecture is unchanged.
