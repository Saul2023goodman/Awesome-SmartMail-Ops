# SmartMail Ops v3.8.42 — Review Trash

## What changed

- Replaced the old `恢复已排除` action with a persistent `垃圾箱` entry in the review toolbar.
- `排除此封` now means: move the mail out of review / scheduling / execution eligibility and into the recoverable trash collection.
- Trash shows a live count badge and a compact popover with excluded mail subject, recipient and source file.
- Supports restoring one mail at a time and `全部恢复`.
- Restoring keeps all manual edits, review content and imported source data; exclusion never deletes the underlying task content.
- No permanent “empty trash” action is provided, reducing the chance of accidental data loss.
- Trash automatically rerenders after exclude / restore / workspace reset, closes on outside click or Escape, and remains available even when every active review mail has been excluded.
- Added a matching outline trash icon to the shared SmartMail icon system.

## Preserved from v3.8.41

- Review cards start from the top-left layout origin.
- Explicit `编辑` and `排除此封` controls.
- Editing invalidates the previous confirmation and requires a new review confirmation.
- Multi-attachment transaction barrier and NetEase Compose-state verification from v3.8.39.

## Validation

- `node --check app.js` passed.
- `manifest.json` parsed successfully and version is `3.8.42`.
- No remaining `nmda-restore-excluded` / `恢复已排除` UI references remain in the active app code.
