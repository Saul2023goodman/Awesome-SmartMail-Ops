# SmartMail v3.8.43 — Style-aware roster planning

## Added

- Preserves the original XLSX visual structure used by the master roster instead of flattening it to values only.
- Compactly records direct Excel formatting:
  - fills / colors;
  - font color, bold, italic and underline;
  - borders;
  - alignment and wrapping;
  - merged cells;
  - row heights and column widths;
  - hidden rows and columns;
  - row-level and column-level styles.
- Date/time cells stored as Excel serial numbers are converted using their number format so schedule columns can be recognized.
- `排期设置` is upgraded to `排期规划` with two views:
  - `名单规划`;
  - `时间规则`.
- Original-format XLSX sheet is rendered as a planning evidence surface.
- Free rectangular selection is supported by pointer drag; Shift can extend from the current anchor.
- Repeated row-fill patterns are detected as **视觉线索（未赋义）**.
- Each detected contiguous color span is clickable to select that area, but clicking never assigns semantics.
- A selection can be explicitly interpreted as:
  - batch / round;
  - priority sequence;
  - fixed send time;
  - business label;
  - clear prior manual interpretation.
- Interpretation evidence stores workbook, sheet, selected cell range and timestamp.
- Existing Excel columns for `priority`, `batch/round`, and `schedule/send time` remain deterministic inputs and are surfaced in the planner summary.
- Manual interpretations override corresponding Excel priority/batch values for matched contacts.
- Manual or Excel fixed schedule values create protected `roster-fixed` times.
- Explicit roster rounds are respected by the scheduler as hard constraints and report a capacity conflict instead of silently reassigning the contact.
- The newest copy of a same-named roster sheet is used as the visual evidence surface after repeated imports.
- Fixed a cumulative-roster expression that could collapse the stored `datasets` list to only `dataset` when preserving the roster across the first mail import.

## Human-in-the-loop rule

Formatting is evidence, not meaning. SmartMail may say “these rows share the same green fill”, but it will not infer “green = R1” or “green = high priority”. Only an operator selection plus an explicit interpretation creates ScheduleIntent.

## Workflow

1. Upload / retain XLSX roster.
2. Open `排期规划`.
3. Inspect the original-format sheet and optional visual clues.
4. Freely select cells/rows.
5. Assign batch / priority / fixed time / label if desired.
6. Continue to `时间规则`.
7. Compile and apply the schedule.

## Compatibility retained

v3.8.42 review trash, v3.8.41 edit/exclude behavior, v3.8.40 top-left review layout, v3.8.39 attachment transaction barrier, cumulative workspace, automatic mailbox sync and existing 163 execution behavior are retained.

## Verification

- `node --check` passed for all extension JavaScript files.
- Planner smoke test passed for rectangular selection → R2 intent and fixed-time intent.
- Scheduler smoke test passed for explicit R1/R2 constraints and protected `roster-fixed` assignments.
- `manifest.json` validates and version is `3.8.43`.
