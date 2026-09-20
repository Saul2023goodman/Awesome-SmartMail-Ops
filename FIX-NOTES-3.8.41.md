# SmartMail Ops v3.8.41 — Review Edit / Exclude Workflow

## Scope
This release keeps the v3.8.40 top-left Review board hard fix and adds the previously requested per-mail edit/exclude workflow.

## Review toolbar
- Added a persistent `编辑` action in the mail review toolbar.
- `编辑` is available for auto-passed, pending, and already-confirmed mail.
- `排除此封` remains next to Edit and is available while reviewing/editing an Initial mail.
- Follow-up tasks keep the same position but use `取消跟进` semantics.
- Removed the duplicate footer entry `发现问题，修正`; there is now one clear entry into edit mode.

## Safer edit semantics
- A manual edit is treated as a new mail version, not an approval.
- `保存并返回审阅` saves recipient / subject / body changes and returns to the read-first audit surface.
- Previous confirmation is invalidated by the edit and is not silently reused.
- The operator explicitly confirms the edited version after reviewing it.
- Direct deterministic repair for missing required fields remains a separate fast path.

## Exclude semantics
- Excluding a mail changes downstream eligibility only; it does not delete the mail or its edits.
- If the operator edits a mail and immediately excludes it, the exact edited values are persisted first.
- Excluded Initial mails do not enter Dispatch / scheduling / execution.
- They remain recoverable through `恢复已排除`.

## Visual behavior
- Edit is a quiet blue operational action.
- Exclude is a restrained danger-quiet action: visible without competing with the main confirmation controls.
- During edit mode the toolbar action changes to `编辑中` (or `补齐中` for direct missing-field repair).

## Retained
- v3.8.40 Review board origin is still explicit wrapping Flex with a deterministic top-left origin.
- v3.8.39 attachment transaction barrier and NetEase Compose-state verification are unchanged.

## Validation
- `node --check app.js`
- `node --check background.js`
- `node --check executor.js`
- `manifest.json` JSON validation
- Static assertions for edit action, correction-save review barrier, edit-preserving exclusion, and retained v3.8.40 Flex origin rules.
