# SmartMail Ops v3.8.45 — Merge restoration + relevant-column projection

## Goal

Improve the independent Roster Planning view so Excel is interpreted as structured evidence rather than a flattened table. The parser now restores merged-cell context and the planner defaults to only the columns needed for identity and scheduling. No source column is deleted.

## Changes

### 1. Merge-aware parsing

- XLSX merge ranges remain stored in `excelVisual.merges`.
- A vertical merge now carries its anchor value down the merge's first column for semantic roster parsing, including merges that span more than one column.
- Single-row/header merges are not expanded semantically.
- The visual planner still renders the original merge instead of showing duplicated values.

### 2. Merge projection after columns are hidden

- Merged ranges are recomputed against currently visible rows/columns.
- If an irrelevant column inside a merge is hidden, `rowspan` / `colspan` is reduced to the visible projection rather than using the original span.
- If the original merge anchor becomes hidden, the first visible cell becomes the render anchor while value/style still come from the original top-left Excel cell.
- This prevents shifted columns or disappearing merged labels.

### 3. Automatic irrelevant-column hiding

The planner detects the roster header and keeps operational columns by default:

- supervisor / name
- email
- institution / school
- country (used by holiday logic)
- priority / order
- batch / round
- schedule / send time
- status
- optional sequence/id column

Other non-empty columns (for example research direction or homepage URL) are collapsed in the planning view by default. Empty columns are also collapsed.

The rule is conservative: if identity columns cannot be detected confidently, the planner keeps all non-empty columns rather than hiding unknown evidence.

### 4. Reversible evidence view

- New `必要列 · X/Y` indicator.
- New `显示全部列 · +N` / `仅显示必要列` toggle.
- Automatically hidden columns are never deleted from the workbook snapshot or normalized dataset.
- Columns already hidden in the source Excel remain source-hidden.

### 5. Real sample check

Using the uploaded `张一凡择导.xlsx`, the planner recognizes:

- visible by default: 学校、国家、导师姓名、导师邮箱
- collapsed by default: 研究方向、导师官网链接

This is a presentation projection only; all six original columns remain available in the evidence layer.

## Compatibility

Retains v3.8.44 independent Roster Planning view, v3.8.43 style-aware evidence/selection model, v3.8.41 review edit/exclude behavior, and v3.8.39 attachment transaction barrier.
