# v3.8.98 · Draft Attachment Live Motion

## Goal
Turn the proven v3.8.97 Draft Attachment Clone-and-Swap transaction into a visible, stage-driven workflow and execute it from the real 163 mailbox surface.

## Interaction
- Starting Draft Attachment Update focuses/opens the connected `mail.163.com` tab.
- The SmartMail utility page keeps a Clone → Verify → Swap motion scene for when the user returns.
- The NetEase page SmartMail Dock enters a dedicated Draft Attachment mode instead of showing the normal bulk-mail UI.

## Real stages
The animation is event-driven, not timer-driven:
1. `read` — read and lock the untouched original draft.
2. `clone` — create the equivalent replacement Compose/draft.
3. `attachments` — server-side migrate preserved attachments plus the replacement source.
4. `verify` — read the replacement back and compare recipients, subject, body, schedule and attachments.
5. `swap` — only after verification, remove the original draft using native `cancelComposes(deleteDraft:true)`.

The native MAIN-world clone code posts stage events to the content executor; the executor forwards them to the service worker, which mirrors them to both the SmartMail app and the 163 Dock.

## UI behavior
- Old-draft and new-draft visual endpoints.
- Attachment token physically travels from old to new during server-side copy.
- Independent verification node appears only during/after real read-back verification.
- Old draft visually retires only when the real swap stage starts.
- Errors freeze the motion at the current transaction and preserve the real error message.
- `prefers-reduced-motion` is respected.

## Routing
The mailbox Dock can return directly to `#utilities/draft-attachments`. Background app routing now accepts the Utilities routes.

## No transaction changes
The successful v3.8.97 Clone-and-Swap provider contract is retained. v3.8.98 adds visibility and stage telemetry; it does not reintroduce `continue(delete)`.
