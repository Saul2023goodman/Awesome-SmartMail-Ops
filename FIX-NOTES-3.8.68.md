# v3.8.68 — Multi-rule format drift batching

## Problem

The Preview Batch Processing panel could detect several independent format drifts, but the format editor held only one active rule. Clicking another detected drift replaced the previous phrase/format selection, so operators had to normalize drift groups one by one.

## Change

Format drift governance now has a **batch rule queue**.

- Multiple detected drift groups can be selected at the same time.
- **全部加入** adds every currently detected drift group to the same execution plan.
- Clicking a detected drift toggles it into/out of the current batch while loading it into the inspector.
- Manually entered phrase + format rules can be added with **加入本次处理**.
- A compact **本次格式处理** queue shows every queued rule, its current affected-mail count, and supports individual removal or clearing.
- The final **应用批量处理** action executes all queued format rules in one pass together with subject completion and Follow-up template changes.

## Execution behavior

- The plan groups all queued rules by affected Task, so each mail is rewritten once even when several rules apply to it.
- Multiple format rules for the same mail are applied against the progressively updated HTML rather than stale original HTML.
- Overlapping phrases are processed longest-first to avoid redundant nested formatting when a shorter phrase sits inside a longer formatted phrase.
- Per-rule history is retained after a multi-rule batch, including changed Task keys and occurrence counts.
- Applied rules are removed from the pending queue after a successful run; unapplied/no-op rules remain visible for inspection.
- Preview feedback highlights all format phrases changed in the active mail at once rather than animating them one by one.

## Persistence

The pending format-rule queue is included in workspace persistence, so closing/reopening the workbench does not lose a prepared multi-rule batch.

## Validation

- `node --check` passes for all extension JavaScript files.
- Manifest version bumped to `3.8.68`.
