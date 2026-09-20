# SmartMail Ops v3.8.64 — Unified Review / Preview

## Product model
Single-mail Review is no longer a second screen. Preview is the canonical mail-review surface; editing is simply an elevated permission state on the same Preview page.

## Changes
- Removed the separate Single Review overlay/dialog, its audit duplicate, pager, hidden form fields, subject-assist branch, and legacy overlay event wiring.
- `Preview` now renders each mail in either read-only or inline-edit mode. `编辑 / 补齐` opens recipient, subject and rich body editing in place without leaving the page.
- Save creates a new mail version and returns that same page to read-only Preview. Exact-version confirmation remains separate: the saved version must still be confirmed when human confirmation is required.
- Added inline `确认无误`, `确认并继续`, and a compact overflow action for exclusion/cancel-follow-up.
- Recipient recovery suggestions now appear directly under the inline To field when needed.
- Rich-text B / I / U editing is preserved in-place, including `bodyHtml` / `bodyIsHtml` for Follow-up derived tasks.
- Preview rail shows `编辑中`; navigation, filters, search, Batch Standards, and leaving Preview are guarded while an unsaved edit is open.
- Batch Standards remains a Preview-level batch QA capability and no longer competes with a separate per-mail Review surface.

## Dead-code cleanup
Removed the legacy overlay markup and its dedicated audit/source renderer, correction-mode state machine, pager/navigation, draft-stash path, subject-assist path, editor listeners, and explicit overlay CSS rules.
- Removed residual legacy Single Review CSS selectors from `workflow-dialogs.css`, `app.css`, and `ui-system.css`; no removed overlay/editor IDs or audit/correction selectors remain in live source.
- Unsaved inline edits now block switching to another mail or leaving the Review stage, preventing silent discard after the two-screen stash path was deleted.
