# v3.8.7 · First-class Review and guided handoffs

## Business flow

The Initial outreach workflow is now represented by three explicit top-level workspaces:

1. **导入资料** — source recognition, mailbox-history dedupe, roster/attachment preparation.
2. **邮件审阅** — recipient/subject/body audit, correction, and Pass decisions.
3. **选择与排期** — execution scope, scheduling, and draft creation.

邮件监测 remains independent and produces Follow-up tasks for the same Dispatch workspace.

## Changes

- 邮件审阅 is now a first-class navigation item instead of an internal Import step.
- Removed the Import page's two-step process rail.
- Import no longer auto-prepares Dispatch merely because every message auto-passed recognition.
- When all Import gates are complete, a visible completion card guides the operator to 邮件审阅.
- Review always shows the batch, including a batch where every message auto-passed.
- When the last Review item passes, the operator stays on Review and sees a visible completion card guiding them to 选择与排期.
- Review no longer auto-navigates to Dispatch immediately after the last Pass.
- Scheduling concerns remain owned by Dispatch; they are not treated as Review blockers.
- If a Review edit changes identity enough to create a new duplicate relationship, the workflow returns to Import dedupe.
- Added `#review` deep link and pending-count badge in the main navigation.

## State boundary

`handoffComplete` now means the Review stage has passed and the batch has been materialized into the unified Dispatch pool. Import completion alone does not set it.
- The 163 mailbox dock now exposes Import, Review, and Dispatch as separate workflow entry points.
