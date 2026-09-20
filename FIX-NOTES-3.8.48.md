# SmartMail Ops v3.8.48 — Explicit-only Batch Planning

## User rule
SmartMail must never invent a roster round from ambiguous evidence.

- Explicit Excel batch/round values such as `R1`, `第1批`, `第一批` can be read directly.
- Explicit valid send times remain fixed-time entries and do not require a batch.
- Priority alone does not create a round.
- Fill color, font color, bold/italic, borders, row position, and other formatting are selection aids only. They never assign a batch automatically.
- Everything else stays `待分` until the operator creates a batch and adds contacts to it.

## Planner interaction
The planner now follows one loop:

1. `＋ 新建批次` creates the next free round label (for example R1, then R2).
2. Select people by a detected formatting feature or by box selection in the Excel canvas.
3. `加入 Rn` assigns the selected contacts to the current batch.
4. Existing batch segments are clickable: they select their members and make that batch current.
5. `移出批次` returns selected contacts to `待分`.

The batch overview contains only batches that actually exist: explicit Excel batches or batches created by the user. There are no default R1–R4 placeholders.

## Recognition changes
- Added conservative style-feature selectors: row fill color, bold, italic, non-default font color, and strong borders.
- These features only select rows; they carry no scheduling meaning.
- Unparseable batch-like text remains unassigned instead of becoming a guessed round.
- Chinese numeric round labels such as `第一批`, `第十批`, and `第十二批` are recognized as explicit rounds.

## Scheduling safety
A matched roster task with no explicit/manual batch and no protected/fixed send time cannot enter automatic scheduling or execution. The planner highlights these contacts as `待分` and asks the operator to create a batch.

This applies at three boundaries:
- opening the time-rule dialog,
- applying the schedule,
- starting mailbox execution.

## Important bug fixed
The previous scheduler converted `plannerRound: null` through `Number(null)`, which equals `0`. This could make an unassigned roster task look like round 1 internally. v3.8.48 now requires a genuinely present round value before treating it as an explicit round.

## Compatibility
Existing user-created batch assignments are migrated and preserved. Explicit Excel batches and fixed times remain intact. Excel styles, merges, focused columns, cumulative imports, mailbox reconciliation, and the attachment transaction barrier are unchanged.

## Adjustment behavior
If an Excel row has an explicit batch, it is shown as recognized. The operator can still move it to another user batch or remove it from batching; the manual override is stored without changing the source workbook.
