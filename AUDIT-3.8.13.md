# SmartMail Ops v3.8.13 Dead-Code Audit

## Goal

Remove code paths that are either unreachable in the current architecture or contradicted by verified NetEase WebMail behavior. Keep only alternate paths that correspond to real provider/UI states or protect persisted user data.

## Provider contracts made strict

### Sent body hydration

The only supported body path is now:

`mbox:readMessage (metadata/context) -> provider readhtml URL -> template#contentTemplate.content`

Removed:

- `response.var.html.content` / `response.var.text.content` body fallback.
- Recursive scanning for arbitrary `content/body/html/text` fields.
- Minimal `{id}` retry after the verified ReadAction request contract.
- Synthetic `read/readhtml3.jsp` fallback when NetEase does not expose a valid read URL in the current mode.
- Alternate `template.innerHTML` / document-wide body-node searches after the verified `contentTemplate.content` structure.

A provider-contract failure now stays visible as a real error instead of being hidden by speculative recovery.

### Draft restoration

The only supported draft-detail path is now `mbox:restoreDraft {id}` and its Compose data model.

Removed:

- `restoreDraft -> readMessage` fallback.
- Recursive object traversal trying to salvage subject/recipient/body from unknown fields.
- Generic body-key guessing.

## Retired architecture removed

- Legacy Contact storage migration and old Contact storage key handling.
- Legacy schedule-preference bridge (`NMDA_LEGACY_PREFS`).
- Hidden standalone ZIP-import input; ZIP remains supported through the current main import input.
- Hidden shared-file compatibility input/state.
- Hidden legacy parser/mapping diagnostics workspace and its handlers.
- Obsolete import-profile persistence/suggestion layer.
- Dead review attachment cue path whose DOM no longer exists.
- Unused direct message endpoints `NMDA_READ_SENT`, `NMDA_READ_DRAFTS`, and `NMDA_READ_INBOX`; mailbox reads now go through the current scoped flows.
- Unused exported helpers and singleton constants found by static identifier audit.
- Unused scheduler summary telemetry that had no consumer.

## CSS reachability audit

All `nmda-*` selectors were compared against the current HTML/JavaScript class vocabulary. Rules whose SmartMail classes no longer exist in the current UI were removed.

Result:

- 1,090 dead CSS rules removed.
- 1,307 dead selector groups removed.
- Remaining unused `nmda-*` selector count after the audit: 0.
- CSS payload reduced by about 150 KB (26.6%) versus v3.8.12.

## JavaScript reachability audit

- Removed declaration-only functions/variables detected by static reference counting.
- Removed unused exported helpers from Import Core, Mail Recognizer, and Importer.
- Removed obsolete message handlers with no sender in the current codebase.
- JavaScript payload reduced by about 44 KB (5.6%) versus v3.8.12.

## Intentionally retained defensive behavior

Not every alternate branch is dead code. The following remain because they correspond to live business/provider states:

- Executor DOM/accessibility variants for different NetEase Compose renderings.
- Success-state observation variants while waiting for NetEase's save/schedule result UI.
- Import format adapters and structured-document parsing alternatives.
- Attachment-source resolution alternatives.
- Follow-up handling for pre-template persisted Derived Tasks (`旧任务待迁移`), because those records can still exist in extension storage after an upgrade.
- Scheduled-draft timestamp reconciliation between list evidence and `restoreDraft` data.

These are reachable compatibility cases, not speculative provider fallbacks.

## Validation

- Every JavaScript file passes `node --check`.
- `manifest.json` parses successfully.
- All CSS files parse successfully with no stylesheet parse errors.
- Static single-reference declaration audit returns no remaining declaration-only JavaScript functions/variables.
- Every remaining `nmda-*` CSS class has a current HTML/JavaScript reference.
- Package contains no test/mock/fixture files.
