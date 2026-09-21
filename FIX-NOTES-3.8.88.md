# v3.8.88 — Recoverable Compose interruptions

- Added a Compose interruption guard that remains active for the lifetime of each remote draft execution.
- Automatically dismisses reverse-engineered NetEase promotional UI for English optimization, AI resume optimization, MailTrace guides, and the large-attachment membership upsell.
- English-optimization before-send dialogs are treated as transaction blockers: after native Cancel closes the guide, SmartMail re-submits only the current save action so the scheduled draft continues.
- Added a recoverable sender-name gate for NetEase `Compose_NoGuide_Popup_NameNotSet`. The batch task stays alive while the native prompt is open; after the user saves a name, NetEase's own `send(e)` continuation is allowed to finish the same task automatically.
- If the sender-name prompt is closed without persisting a name, SmartMail re-arms `ntes_compose.senderName=0` and restores the native prompt instead of silently bypassing the check.
- Added MAIN-world sender-state inspection bound to the exact `compose.ComposeModule` identity so a resumed task cannot attach to another Compose tab.
- Mail dock now shows sender-name completion as a soft `waiting-user` state with no manual Resume button; completion resumes automatically.
- Unknown/business-critical dialogs are not auto-dismissed. Existing evidence-based success checks remain required before advancing to the next task.
