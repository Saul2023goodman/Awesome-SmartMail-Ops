# v3.8.20 · Unified auto-review

- Follow-up now uses the same Review intent as Initial: complete deterministic content auto-passes; only exceptions require operator confirmation.
- Template generation runs the Follow-up Review classifier immediately. Valid tasks are stamped `reviewDecision=auto`, exact-version confirmed, and queued into Selection & Scheduling.
- Invalid generated tasks remain `prepared / awaiting-review` and appear under Review → 需处理.
- Manual confirmation uses `reviewDecision=manual`. Any later recipient/subject/body/compose-mode edit clears either decision, increments `contentVersion`, and dequeues the task.
- Review UI distinguishes 自动通过 from 已确认 instead of treating every Follow-up as 待审阅.
- Monitoring notices report auto-passed vs exception counts after single or batch generation.
- Runtime-only storage boundary from v3.8.19 is unchanged.
