# v3.8.54 — Follow-up automatic-reply recognition

## Principle
Follow-up cares about **effective human reply**, not merely the existence of any inbound message. Automatic/system replies are mailbox facts but do not stop the follow-up clock and do not block task generation.

## Classification
Automatic reply detection now uses deterministic multi-signal rules:

- NetEase/provider automatic-reply, vacation, out-of-office and auto-submitted flags.
- Strong subject patterns such as `Automatic Reply`, `Auto Response`, `Out of Office`, vacation/absence notices, and Chinese automatic-reply equivalents.
- Automatic responder sender-name/local-part patterns.
- Inbox preview text when the mailbox list exposes it, including typical OOO/leave/limited-email-access phrases.
- **Near-immediate response heuristic:** a reply directly associated with the outbound thread and received within **3 minutes** is treated as `automatic`.

## Safety / correction
The 3-minute rule is marked as heuristic evidence. It is non-blocking by default, but Mail Monitoring exposes the observation as “已按自动回复忽略” with a one-click **“计为已回复”** correction. A manual correction is persisted in the current runtime store and reconciliation will not overwrite it.

## Follow-up behavior
- `automatic`, `system`, and bounce observations do not stop Follow-up.
- `human` still permanently stops automatic Follow-up for the conversation.
- `ambiguous` still blocks until the operator decides.
- Manual disposition always overrides automatic classification.

## Regression cases
- `Automatic Reply: ...` several hours later → automatic / non-blocking.
- Typical OOO preview text → automatic / non-blocking.
- Direct reply 2 minutes after send → heuristic automatic / non-blocking.
- Direct reply 5 minutes after send with no automatic signal → human / blocking.
- Heuristic automatic manually changed to human → blocking state is recalculated immediately.
