# v3.8.93 — Draft Attachment Update

## Semantic rebuild

“极速附件” no longer optimizes attachments for the current Compose/Dispatch batch. It is now a standalone Draft Attachment Update utility for replacing obsolete attachments inside already-existing NetEase drafts (`fid=2`).

## New workflow

1. Scan the real NetEase Drafts folder and restore each draft through `mbox:restoreDraft`.
2. Group ordinary attachments by exact filename + size so old versions are visible as mailbox facts rather than import-batch assets.
3. Select an old attachment version and choose the specific existing drafts to update.
4. Upload the replacement local file once into a temporary NetEase draft.
5. Resolve its authoritative `messageId + partId` through `mbox:listAttachments`.
6. For every selected target draft:
   - add the replacement using `mbox:compose(action="continue")` with `type:"internal"`;
   - read the target draft back and verify the new attachment exists and non-attachment fields are unchanged;
   - only then delete the old attachment ids with another `continue` mutation;
   - read back and verify again.
7. Delete the temporary source draft.
8. Re-scan Drafts and perform a final integrity check: old attachment ids gone, replacement still present, subject / To / Cc / Bcc / body / schedule unchanged.

## Safety behavior

- Add-new-before-delete-old: a failed add never removes the old attachment first.
- A failed delete can leave both versions in the draft, which is surfaced as a failure instead of risking attachment loss.
- Scheduled drafts are updated in place; the mailbox-list schedule is rechecked after the batch.
- Locked/unreadable drafts are excluded instead of being silently mutated.
- Cloud-link attachments are not treated as ordinary replaceable attachments.
- Replacement files with the exact same filename and size as the selected old version are currently blocked because the mailbox metadata available to this utility cannot reliably distinguish versions after the final rescan.

## Dead code removed

Removed the entire v3.8.91 Compose-batch fast-attachment optimization path:

- no Fast Attachments preference in Dispatch;
- no attachment session id / source cache / reuse-count planning;
- no `NMDA_FAST_ATTACHMENT_*` handlers;
- no Compose-task server-reuse branch;
- no batch attachment reuse telemetry;
- no old Fast Attachments cards, switches, pending-plan CSS, or Dispatch shortcut;
- internal route renamed to `draft-attachments`.

“极速 Compose” remains independent and unchanged.
