# SmartMail Ops v3.8.65 — Import regression fix

## Root cause

v3.8.64 removed the legacy Review bulk-subject UI but left two initialization/reset references in `app.js`: `reviewBulkSubjectInputEl` and `hideBulkSubjectPrompt()`. Because those identifiers no longer existed, importing a dataset threw before the Review workspace could initialize.

## Fix

- Removed the two remaining legacy bulk-subject references from both import initialization and workspace reset.
- Replaced the obsolete input reset with the current Batch Standards subject field: `batchStandardSubjectInputEl`.
- Did **not** restore the old bulk-subject component or its prompt logic. Subject completion remains exclusively under Preview → Batch Standards → Subject Integrity.
- Bumped extension version to 3.8.65.

## Regression checks

- No references to `reviewBulkSubjectInputEl` remain.
- No references to `hideBulkSubjectPrompt` remain.
- JavaScript syntax validation passes.
- ZIP integrity passes.
