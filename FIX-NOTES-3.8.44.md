# SmartMail Ops v3.8.44 — Independent Roster Planning View

## Why
v3.8.43 proved the style-aware roster model, but the workbook mirror, visual clues, free selection and intent controls were all packed into the schedule modal. A real Excel workbook needs substantially more horizontal and vertical space, so the interaction surface was too constrained.

## What changed

### 1. Roster planning is now a first-class Dispatch subview
- `排期规划` opens an independent full-content workspace inside `选择与排期`.
- The normal execution matrix is temporarily replaced rather than covered by a dialog.
- `← 返回选择与排期`, `完成名单规划`, and `继续：时间规则 →` provide explicit navigation.
- `Esc` returns from the roster view when no modal is open.

### 2. Three-surface workspace
The new view is split into:
- **Source / evidence rail** — workbook + sheet selector, source summary, style clues, evidence-layer explanation.
- **Original Excel canvas** — the preserved workbook mirror gets the majority of the available area and remains independently scrollable.
- **Interpretation inspector** — selected range, semantic type, value/time, apply/clear controls and current manual Intent summary.

This mirrors the existing import classification philosophy: evidence is visible in a dedicated work surface, while the right-side inspector owns the human decision.

### 3. Time rules return to a compact modal
The schedule modal now contains only deterministic time rules:
- start time
- max contacts per institution per round
- interval days
- preserve existing times
- include NetEase existing schedules
- skip holidays/weekends

Roster interpretation no longer competes for modal space.

### 4. Clear navigation from the Dispatch matrix
The Dispatch header now exposes two distinct operations:
- **时间规则** — quick access to the deterministic rule dialog.
- **排期规划** — opens the full roster-aware planning workspace.

When schedule application succeeds from the roster flow, SmartMail closes both the rule modal and the roster subview and returns to the updated matrix.

### 5. Existing v3.8.43 semantics are unchanged
- XLSX formatting is still evidence only.
- Colors never receive business meaning automatically.
- Visual clues only select candidate ranges.
- Free rectangular selection remains available.
- Manual roster Intent, Excel priority/batch/fixed-time and scheduler precedence remain unchanged.

## Validation
- `node --check app.js`
- `node --check roster-planner.js`
- `node --check scheduler.js`
- `node --check background.js`
- `node --check executor.js`
- `manifest.json` JSON validation
- checked for duplicate roster planner DOM ids
