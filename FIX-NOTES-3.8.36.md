# SmartMail Ops v3.8.36 — Roster ↔ Draft Reconciliation

## What was wrong
The roster matcher still existed in v3.8.35, but it mainly matched the current imported Tasks. Mailbox Drafts were synchronized into the operation store and used for recipient-based history dedupe, so there was no longer a clear, first-class roster ↔ Draft association layer. This was especially weak when the roster and Drafts arrived in separate imports.

## What changed
- Added an explicit `NMDARoster.reconcileDrafts()` stage.
- Matching priority is deterministic: exact email → name + school/domain → unique-name fallback.
- Builds a stable roster-to-Draft association table and reports:
  - roster contacts with Drafts;
  - roster contacts without Drafts;
  - Drafts not present in the roster;
  - ambiguous Draft matches;
  - multiple Drafts mapped to one roster contact;
  - scheduled Draft count.
- A roster upload now automatically requests a complete Draft/history refresh; no need to enter Dispatch first.
- The import audit now visibly includes `总名单 ↔ Draft` instead of hiding this relationship inside generic dedupe.
- High-confidence roster bridging is connected back into the existing Draft-history gate. If a new Task and an existing Draft both map strongly to the same roster contact, SmartMail warns that the contact already has a Draft even when a direct recipient-string match is unavailable.
- The existing safety behavior remains conservative: ambiguous/name-only weak matches are shown for review, not silently treated as duplicates.

## Multiple-import behavior
The cumulative workspace from v3.8.35 remains intact. Roster, mail documents, mailbox Drafts, and attachments can be added in separate passes. Reconciliation is recomputed from the combined workspace after each change.

## Persistence
Roster changes are now explicitly persisted after add/remove actions, in addition to the existing cumulative workspace persistence. Mailbox facts themselves still refresh from 163 rather than being treated as permanent local truth.
