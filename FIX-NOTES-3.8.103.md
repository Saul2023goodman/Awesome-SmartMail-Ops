# v3.8.103 · Draft attachment replacement hang / cancellation fix

## Root causes

- The attachment replacement workbench awaited long-running `chrome.runtime.sendMessage()` calls directly. If an executor-side promise or provider request failed to settle, the UI could remain in `running` forever.
- Attachment replacement had no dedicated cancellation protocol. The mailbox dock intentionally hid its stop button for draft-attachment runs, so once the process moved to 163 the operator had no way to stop it.
- The executor's upload wait was cooperative only with NetEase attachment state and could wait for a long absolute ceiling; it did not observe a SmartMail cancellation signal.
- Clone/swap `DataAction` requests had no response timeout, so a missing provider callback could strand the mutation transaction.
- Replacement discovery repeatedly scanned the entire Drafts folder (`readMailbox(..., -1)`) even though a just-created replacement must be among the newest drafts. Large mailboxes therefore made “start execution” look frozen.

## Fix

- Added a real **停止本次更新** action in both the SmartMail attachment workbench and the 163 execution dock.
- Added `NMDA_DRAFT_ATTACHMENT_CANCEL` / broadcast cancellation across app → service worker → executor → MAIN-world clone transaction.
- App-side long steps now have bounded waits and a local cancellation race, so the UI can always leave the running state.
- Runtime-file transfer, attachment registration/upload waits, draft-save waits, clone construction and pre-swap verification now observe cancellation.
- A cancel request rolls back a replacement clone while the original draft is still untouched; once the provider has entered the final old-draft removal transaction, that one safe transaction is allowed to finish and no next draft starts.
- Provider `DataAction` calls in clone/swap and rollback paths now have timeouts instead of waiting forever.
- Replacement discovery and old-draft disappearance checks inspect the newest 300 drafts rather than rescanning the full Drafts folder on every attempt.
- Upload has an app-level 120 s guard and each draft transaction has a 90 s guard. A timeout requests remote cancellation and returns the UI to a recoverable state.

## Safety behavior

- Cancellation does not delete the original draft merely to stop quickly. The current clone transaction is either rolled back before swap or allowed to finish its already-started atomic swap; remaining drafts are skipped.
- Temporary attachment source cleanup is still attempted with a bounded timeout.
- Existing clone → verify → swap integrity checks are preserved.
