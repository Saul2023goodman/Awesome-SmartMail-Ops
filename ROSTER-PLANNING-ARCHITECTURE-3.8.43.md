# SmartMail v3.8.43 — Style-aware Roster Planning Architecture

## Goal

Turn the scheduling configuration from a rule-only modal into a roster-aware planning workspace without flattening away the operator's Excel evidence.

The master roster can carry information in both values and presentation: fill colors, bold text, borders, merged cells, row heights, column widths and hidden rows/columns. These visual signals are evidence, not semantics. SmartMail may recognize repeated visual patterns, but it must not decide that a color means “priority”, “round 1”, or “already contacted” without operator authorization.

## Four-layer model

1. **Evidence layer — ExcelVisualSnapshot**
   - Cell values remain available to the deterministic roster parser.
   - XLSX direct formatting is compactly preserved as `styleTable + cellStyles + rowStyles + colStyles`.
   - Merged ranges, row heights, column widths and hidden rows/columns are preserved.
   - Date-formatted Excel serial values are converted to deterministic date/time text for field parsing.

2. **Interpretation layer — RosterEntry**
   - Existing header parsing still extracts only business fields required by SmartMail: identity, email, institution, country, priority, batch/round, schedule time, tags and notes.
   - The original sheet is not replaced by this normalized representation; both coexist.

3. **Authorization layer — ScheduleIntent**
   - The planner detects visual clues such as repeated whole-row fills.
   - Visual clues only help select ranges. They never assign meaning automatically.
   - The operator may freely drag a rectangular range, Shift-extend a selection, or click a detected visual span.
   - A selected range can be explicitly interpreted as:
     - batch / round;
     - priority sequence;
     - fixed send time;
     - business label;
     - clear manual interpretation.
   - Intent is stored by stable roster identity and includes source workbook, sheet, cell range and timestamp evidence.

4. **Compilation layer — Schedule Assignment**
   - Manual roster interpretation overrides matching Excel priority/batch fields.
   - Excel priority/batch still work when explicitly present as columns.
   - Manual or Excel fixed send time becomes `roster-fixed` and is protected from ordinary auto reflow.
   - Explicit rounds are hard constraints. If an Excel/manual round exceeds the configured school capacity, scheduling fails visibly instead of silently moving the person elsewhere.
   - Remaining tasks are filled by the existing deterministic scheduler around protected times, mailbox schedule anchors and non-working-day rules.

## Precedence

For scheduling facts the intended precedence is:

1. explicit task-level/manual schedule already stored on the task;
2. mailbox/imported protected schedule;
3. manual roster fixed-time interpretation;
4. Excel fixed-time column;
5. manual roster batch/priority interpretation;
6. Excel batch/priority columns;
7. automatic schedule rules / source order.

A visual style such as color never appears in this precedence until the operator has interpreted a selected range.

## Workbook update behavior

- Up to the latest roster workbook snapshots are retained in the current workspace.
- If the same workbook/sheet name is imported again, the newest snapshot is used as the visual evidence surface.
- ScheduleIntent is identity-based rather than row-number-based, so a supervisor can move to another row without losing an already-authorized interpretation when the identity still matches.
- The source range remains evidence of where the interpretation was originally created.

## Current v3.8.43 scope

Preserved visual formatting covers direct XLSX cell/row/column styles (fill, font traits and color, borders, alignment/wrap), merged cells, dimensions and hidden rows/columns. Formula-driven conditional formatting and embedded drawings are not evaluated as semantic signals in this first vertical slice. They remain outside automatic interpretation by design.

## UI workflow

`排期设置` becomes `排期规划` with two steps:

1. **名单规划** — view the original-format sheet, inspect detected visual clues, freely select a range, and authorize intent.
2. **时间规则** — configure start time, school capacity, interval, mailbox anchors and non-working-day handling, then compile/apply the plan.

The footer on the roster step says `继续：时间规则 →`; it does not apply the schedule prematurely.
