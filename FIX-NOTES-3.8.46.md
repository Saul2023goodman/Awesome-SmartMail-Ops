# SmartMail Ops v3.8.46 — Simplified roster batching

## Goal
The roster-planning view now follows the user's real task: decide **who belongs to which batch**. Technical interpretation concepts are removed from the main UI.

## New interaction model
There are only two ways to select contacts:

1. **Select by color** — click one detected row color to select every roster contact using that color.
2. **Box select** — drag directly across the Excel mirror to select the contacts covered by the rectangle.

After either selection, assign the result with one click to **R1 / R2 / R3 / R4**, or choose R1–R12 from the compact “更多批次” control.

## Color behavior
- A color is only a selection shortcut. SmartMail does not infer what the color means.
- One color button represents all matching roster rows, including non-contiguous rows.
- Color buttons show contact count and current assignment state (`R1`, `R2`, etc. or `混合`).
- Colors that do not correspond to any parsed roster contact are not shown.

## Box selection
- Existing free rectangular selection remains available.
- Starting a box selection automatically leaves color-selection mode.
- The right panel immediately reports the number of matched contacts.

## Batch controls
- Quick buttons: 第 1 批 / 第 2 批 / 第 3 批 / 第 4 批.
- Extended selector: R1–R12.
- “移出批次” removes only the manual batch assignment; the roster contact and source evidence remain intact.
- If the current selection is already wholly in one of R1–R4, that batch is visibly highlighted.

## Simplified copy
Removed user-facing terminology such as:
- “视觉线索”
- “Interpretation”
- “Intent”
- “解释为”
- manual priority/fixed-time/label controls

The underlying roster parser still preserves workbook styles, merges, explicit Excel priority/batch/schedule fields, and source evidence. Those implementation details no longer burden the batching workflow.

## Preserved capabilities
- Original XLSX formatting remains intact.
- Merge restoration remains intact.
- Irrelevant columns remain collapsed by default, with “查看全部列”.
- Existing Excel batch fields continue to participate in the effective batch state.
- Existing schedule compiler, manual schedule overrides, NetEase scheduled-draft constraints, cumulative imports, and attachment transaction barrier are unchanged.

## Validation
- `node --check app.js` passed.
- `node --check roster-planner.js` passed.
- `manifest.json` parsed successfully.
- `applyBatchToEntries` smoke test covered assignment, partial clearing, and preservation of another contact's assignment.
