# SmartMail Ops v3.8.63 — Batch Standards Lens

## Product model
Preview now owns one batch-level quality-control component: **Batch Standards**. Missing subjects and body-format drift are no longer separate workflows. They are both deterministic normalization problems created during template derivation.

## Changes
- Removed the Review-board `一键补主题` control and its horizontal prompt.
- Renamed the floating Preview Format Lens to **批次规范**.
- Added subject-completeness scan inside the lens. It only targets blank Initial subjects and never overwrites populated subjects or rewrites Follow-up subject chains.
- A dominant existing subject (>=70% of populated drafts) is shown only as a user-selectable reference; it is never silently applied.
- Kept manual fixed-phrase formatting and deterministic format-drift discovery in the same lens.
- The bottom action now builds a single correction plan: subject fixes + format fixes are merged by task. If one mail needs both, Preview visits it once and applies both changes in the same visual pass.
- Sequential execution still writes each task immediately and preserves Preview position after completion.
- Added subject-line capture / settle motion so subject repair participates in the same restrained rewrite language as body-format repair.

## Boundary
This feature normalizes deterministic presentation metadata and formatting. It does not generate or rewrite prose, does not overwrite existing subjects, and does not infer a subject when existing subjects are inconsistent.
