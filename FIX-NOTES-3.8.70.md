# 3.8.70 — recipient-level Follow-up lineage

- Follow-up history is now grouped by recipient identity rather than recipient + subject.
- With no inbound reply, the chronologically earliest sent message to a recipient is the initial outreach; every later outbound to the same recipient is counted as an observed Follow-up even when the subject changes.
- This prevents later sent messages from incorrectly starting independent Follow-up chains and being offered another Follow-up.
- Automatic-reply feature/evidence text is no longer shown in Mailbox monitoring. Automatic/system classification remains internal so it can continue to avoid treating those messages as human replies.
- Ambiguous inbound messages still expose manual disposition controls.
