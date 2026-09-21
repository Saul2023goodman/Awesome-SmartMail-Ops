# SmartMail Ops v3.8.95 — Draft Attachment CID Transaction Fix

## Failure reproduced

Draft Attachment Update could fail every target with `mbox:compose continue code=FA_ID_NOT_FOUND`, and cleanup of the temporary seed could fail with `mbox:deleteMessages code=FA_HOOK_SECURITY_3`.

## Provider root causes

NetEase's native ComposeAction contract uses two different identifiers:

- Draft mailbox ID (MID): input to `mbox:restoreDraft`.
- Compose session ID (CID): returned as `restoreDraft().var.id` and required by `mbox:compose(action="continue")`, `mbox:getComposeInfo`, and `mbox:cancelComposes`.

The old updater passed the draft MID directly as the target `id` of `action="continue"`. NetEase's own `syncAttach()` and `deleteAttach()` use `this.info.get({cid:true})`, so the old request was at the wrong ID layer and the provider correctly returned `FA_ID_NOT_FOUND`.

The old temporary-seed cleanup used mailbox-level `mbox:deleteMessages`, which is guarded by NetEase's security hook and returned `FA_HOOK_SECURITY_3`. Native Compose deletion uses `mbox:cancelComposes` with `deleteDraft:true` instead.

## New transaction

Each target draft now executes one provider-native transaction:

1. `mbox:restoreDraft({id:MID})`
2. obtain `CID = response.var.id`
3. remap requested old attachments to the attachment IDs returned by this exact restored CID
4. server-copy the new attachment with `mbox:compose({id:CID, action:"continue"})`
5. verify that the new attachment exists in current compose state
6. delete the remapped old attachment IDs on the same CID
7. commit with `mbox:compose({id:CID, action:"save"|"schedule", attrs:...})`
8. cancel the edit session with `mbox:cancelComposes({ids:[CID]})`
9. restore the mailbox draft again and verify attachment + content/schedule integrity

Normal attachments remain bound to the CID and are not redundantly rebuilt into the final attrs payload. Inline/mixed metadata is preserved when present.

## Stale attachment-ID fix

Attachment IDs collected during the mailbox scan are no longer treated as permanent IDs. A later `restoreDraft` can produce a new compose session, so the updater remaps old attachments inside the current session by exact ID first, then by name + size. If a complete remap cannot be proven, that target is aborted before mutation.

## Safe seed cleanup

The temporary upload seed stays alive until target mutations finish. Cleanup now prefers the exact ComposeModule's native `action.cancelId({deleteDraft:true})`. If the module was already switched away or closed, the saved CID is used with the same native `mbox:cancelComposes({ids:[cid], deleteDraft:true})` contract. The old raw draft-delete path is removed.

## Read-only session cleanup

Every `mbox:restoreDraft` used only for scanning now cancels its temporary CID after extracting the draft data. This prevents large draft scans from leaking server-side compose sessions.

## Concurrency

Draft mutation concurrency is capped at 3 independent CID transactions. This is not a timing delay; it reduces simultaneous provider compose sessions while retaining batch throughput.

## Safety invariants

- old attachment is never deleted before the replacement is confirmed in the current CID
- pre-commit failure cancels the compose transaction instead of committing a partial edit
- cloud-link drafts are excluded from this headless mutation path
- subject, recipients, CC/BCC, body, HTML mode, and scheduled-send time are re-read after commit
- temporary source deletion no longer uses the security-hooked mailbox-delete endpoint
