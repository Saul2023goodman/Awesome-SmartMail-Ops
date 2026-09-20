# v3.8.59 — Preview-native Batch Format Governance

## Why this refactor

Batch format repair is not a per-mail review action. It compares the same phrase across many template-derived drafts and repairs batch-wide consistency. The correct place is Preview, where the operator can visually scan the whole batch and immediately verify the result.

The responsibility split is now explicit:

- **Review board:** per-mail state, exceptions, confirmation, and direct edits.
- **Preview:** batch-wide visual QA, semantic/format highlighting, and deterministic batch format governance.

## UI / workflow changes

- Removed `批量格式` from the Review board toolbar.
- Added `批量格式` to the Preview toolbar only.
- The Preview button shows a small badge when deterministic drift detection finds inconsistent fixed-phrase formatting.
- The governance panel expands directly below the Preview toolbar while the continuous mail preview remains visible underneath.
- Leaving Preview automatically closes the batch-format panel, preventing batch-level controls from leaking into the single-mail Review mental model.

## Behavior retained

- Exact fixed-text matching and optional case sensitivity.
- Italic / bold / underline / strike combinations.
- Deterministic format-drift suggestions.
- Preview-before-apply and idempotent repair.
- Cross-paragraph safety skip.
- `bodyHtml` preservation through NetEase execution.
- No wording rewrite and no AI/NLP.

## Preview-specific improvements

- Applying a batch format rule refreshes Preview in place.
- The active Preview mail, main scroll position, and rail scroll position are restored after the batch repair.
- Drift indicators refresh when Preview data changes, but are not recomputed on every scroll-driven render.

## Invariant

`Review = single-mail handling`

`Preview = batch-wide visual QA + batch format governance`
