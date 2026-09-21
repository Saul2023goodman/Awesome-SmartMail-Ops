# Fix Notes 3.8.105 — Verified temporary attachment-source cleanup

## Symptom
After a successful batch attachment replacement, the one-time SmartMail attachment-source draft could remain in the 163 Drafts folder even though the UI considered cleanup successful.

## Root cause
The cleanup path treated a successful `mbox:cancelComposes(..., deleteDraft:true)` callback as proof that the saved draft was deleted. On 163 this callback can acknowledge compose cancellation before the saved Draft MID has actually disappeared. No mailbox verification was performed, so an acknowledged-but-retained seed became a false cleanup success.

## Fix
- Carry the exact temporary Draft MID (`seedDraftId`) through App → Executor → Background cleanup.
- Cleanup can run with the Draft MID even if the original ComposeModule identity is gone.
- First attempt the live native Compose cancellation.
- Re-read Drafts and require the seed MID to be absent before returning `ok:true`.
- If the MID remains, use the already-proven native deletion route used by clone/swap: `restoreDraft(seed MID) -> fresh CID -> cancelComposes({deleteDraft:true})`.
- Re-read Drafts again and only report success after confirmed absence.
- Increase the cleanup wait window so the verified transaction is not cut off by the UI timeout.
- The final safety cleanup also receives the Draft MID and can continue even if the compose tab/module disappeared.

## Invariant
A batch attachment update is no longer considered fully cleaned up merely because NetEase returned a success code. The temporary source must actually be absent from the Drafts mailbox.
