# v3.8.5 — Draft History Filtering

## Business rule
Mailbox Draft history is not a version-comparison problem. It is evidence that a provider Draft already exists for the recipient, so Import should avoid creating another Initial Task by default.

The Import dedupe stage now uses three different semantics:

- **Current batch duplicate** → compare imported versions and decide which version(s) enter the batch.
- **Existing Draft only** → show a compact hit/filter list. No body/version comparison. Selected new Initial Tasks can be filtered out, with an explicit keep exception.
- **Existing Sent** → keep the explicit outbound-history decision because a prior send may mean the operator should use Mail Monitoring → Follow-up instead of creating another Initial Task.

If both Draft and Sent history exist, Sent is the stronger business fact. The decision surface is treated as Sent history; Draft count may be shown as supporting evidence but Draft content is not compared.

Mailbox-Draft adoption (`读取草稿箱`) still bypasses new-mail duplicate checking because it operates on existing provider drafts rather than creating new Initial Tasks.
