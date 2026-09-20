# 3.8.69 — Demand-driven batch controls

- Hide Follow-up template controls from Preview batch processing when there is no active/due Follow-up context.
- Reveal them when a Follow-up task exists, a monitored thread is due for Follow-up, or the user explicitly opens the template from Mail Monitoring.
- Remove visible template revision labels such as `v1` / `v2`; keep revisioning internal only.
- Batch-processing header and counters no longer treat an unused Follow-up template as pending work.
- Preserve existing internal template version semantics for exact updates and synchronization.
