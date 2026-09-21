# v3.8.97 — Draft Attachment Clone-and-Swap

## Root cause

The remaining `FS_UNKNOWN` was not a simple request-field mismatch. NetEase source shows that `ComposeAction.deleteAttach()` is only one internal step of `ComposeAttach.remove(file)`: a restored draft is hydrated into the live Compose attachment model, each storage attachment becomes a file object with a session `sid`, then `remove(file)` invokes `deleteAttach`, clears the sid, removes the file from the model, and lets the Compose save lifecycle persist the change.

SmartMail had reproduced only the detached `mbox:compose(action=continue, deleted:true)` request. Real 163 repeatedly rejected that detached delete with `FS_UNKNOWN` even after MID/CID and `returnInfo` were corrected. This proves that the endpoint is not a reliable general-purpose Draft mutation primitive for this workflow.

## Strategy change

The production updater no longer calls `continue(delete)` at all. It now uses a provider-native clone-and-swap transaction:

1. Read the untouched original draft through `mbox:restoreDraft`.
2. Resolve every attachment that must be kept through `mbox:listAttachments` to stable mailbox `_mid + _part` sources.
3. Create a fresh Compose CID and server-copy all kept attachments plus the replacement attachment with the native `syncAttach`/`continue(returnInfo:true)` contract.
4. Save or schedule the replacement draft with the original account, recipients, subject, HTML body, receipt/priority/charset settings and schedule. For scheduled drafts, the mailbox-list schedule remains authoritative, matching NetEase's own timeset restore path.
5. Independently re-read the replacement from Drafts and verify content, recipients, schedule, kept attachments, absence of the obsolete attachment, and presence of the replacement.
6. Only after verification, delete the original through the native Draft Compose lifecycle: `restoreDraft(original MID) -> cancelComposes({ids:[CID], deleteDraft:true})`.
7. If verification fails, delete the replacement and leave the original untouched. If deletion of the original fails, roll back the replacement to avoid duplicate scheduled messages.

## Safety changes

- In-place `continue(delete)` is removed from production code.
- Draft replacement runs serially so a newly scheduled replacement can be identified unambiguously before swapping.
- Inline/mixed and cloud-link drafts are rejected rather than silently reconstructed.
- The temporary replacement source is still uploaded once and reused server-side.
- Existing draft IDs may change after a successful swap; the UI already tracks the committed replacement ID.
