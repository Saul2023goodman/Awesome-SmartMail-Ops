# SmartMail v3.8.61 — Follow-up Sent-history reconciliation

## Problem

The previous Follow-up sequence relied too heavily on SmartMail-owned `derivedTasks` / linked draft lineage. A real mailbox history such as:

`Initial sent -> no effective reply -> another sent message`

could leave the second outbound as a separate auto-monitored `initial` root. The monitor could then incorrectly offer Follow-up #1 again.

## Model correction

Sent mailbox history is now authoritative evidence of completed Follow-ups. For the same deterministic conversation key (recipient set + normalized subject), chronological outbounds receive an effective observed sequence. The first send is Initial; subsequent sends are F1, F2, ... even when they were sent manually or by an older workflow.

The original linkage fields are not destroyed. Observational fields record the inferred sequence and its source so provenance remains visible.

## Reconciliation

- Monitoring collapses repeated no-reply outbounds into one conversation row.
- Eligibility starts its delay clock from the latest observed outbound.
- `maxAttempts` counts mailbox-observed Follow-ups.
- A stale generated F1/F2 already covered by Sent history is reconciled to `sent` and dequeued.
- Auto-replies remain non-blocking and do not reset the outbound sequence.
- Effective replies still terminate Follow-up automation at conversation level.
- Ambiguous replies remain blocking until manually resolved.

## Verification

Regression coverage includes Initial-only, Initial+manual F1, Re/Fw subject normalization, different-subject separation, auto-reply between sends, effective reply termination, max-attempt counting, and stale generated-task reconciliation.
