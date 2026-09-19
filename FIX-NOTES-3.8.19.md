# v3.8.19 · Runtime-only operations

- Reframed SmartMail as a batch execution tool rather than a persistent local operations database.
- Removed `chrome.storage.local` persistence for mailbox facts, Derived Follow-up Tasks, Review state, Dispatch state and reconciliation history.
- Removed the manifest `storage` permission.
- Removed the IndexedDB attachment vault. Attachments now stay in the open app page's memory and stream to the 163 executor through an ephemeral runtime Port.
- Follow-up and Initial operational state now disappears on app reload/close or mailbox-account switch.
- A manual mailbox read is therefore valid only for the current app session; Import dedupe and Follow-up monitoring require a new read in a new session.
- Kept only reusable preferences in `localStorage`: Follow-up template/global rules and scheduling rules.
