# SmartMail Ops v3.8.32 — Inline Mailbox Sync + Ready-State Handoff

## 1. Header overlap fixed

The mailbox connection card and automatic-sync indicator are no longer separate expanding pills.

- Automatic sync is now embedded into the second line of the mailbox connection card.
- The account, sync motion and “switch mailbox” action share one bounded responsive capsule.
- Syncing/success/error changes color and motion, but no longer changes the header width.
- The sync rail remains globally visible across Import, Review, Dispatch and Monitoring.

## 2. Ready mail no longer waits for a navigation click

Previously, Initial tasks only entered the Dispatch queue after the operator clicked the “enter selection & scheduling” action, because `batch.handoffComplete` was set inside that navigation path.

Now SmartMail automatically performs the handoff when all readiness gates are satisfied:

- import/source preparation complete;
- mailbox history dedupe snapshot available;
- duplicate decisions resolved;
- attachment requirements resolved;
- no pending review issues;
- no pre-planning blockers.

The handoff happens in the background without changing the current page. The Review action becomes **“查看选择与排期 →”** after the handoff instead of being the gate that creates the Dispatch pool.

## 3. Mailbox sync is eager at readiness

If a batch becomes otherwise ready but the mailbox history snapshot is not yet available, SmartMail automatically requests the required history read first. After the history read is applied, task rebuilding re-evaluates readiness and automatically completes the Dispatch handoff.

This is triggered from import completion, preflight completion, task rebuilding and Review readiness, so it no longer depends on entering the Dispatch page.

## Validation

- `app.js`: syntax checked with Node.
- `background.js`, `mail-dock.js`, `operations.js`, `dispatch.js`: syntax checked.
- `manifest.json`: parsed successfully.
- Extension version: `3.8.32`.
