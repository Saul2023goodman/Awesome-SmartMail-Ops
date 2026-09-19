# v3.8.4 — Dedupe Semantics Refactor

## Why the previous model was incomplete

The Import dedupe gate only treated duplicates inside the current batch as actionable. Existing mailbox Draft and Sent facts were displayed as history hints, so a new Initial Task could still proceed even when the same recipient already had a draft or a previous outbound message.

This is operationally unsafe because dedupe exists to prevent creating another outbound action when an equivalent contact attempt already exists outside the current import.

## New dedupe boundary

For tasks that will create a **new Initial email**, Import now checks three sources:

1. Current-batch duplicates (exact email / probable same person).
2. Existing mailbox drafts for the same recipient.
3. Existing Sent records for the same recipient.

Mailbox-history hits are blocking Import decisions, not informational warnings. The operator must explicitly either:

- exclude the newly imported Initial Task, or
- keep it as an intentional exception.

When a Sent record exists, the UI explains that continued outreach should normally be created through Mail Monitoring → Follow-up rather than by creating another Initial Task.

## Why mailbox-draft import bypasses dedupe

`读取草稿箱` imports existing provider drafts. These tasks are marked `sourceKind = mailbox-draft` and are treated as **adopting an existing mailbox object**, not creating a new outbound object.

Running new-mail dedupe on them would be incorrect because:

- checking them against Existing Drafts produces a guaranteed self-match;
- several real drafts to one recipient may be intentional and must not be auto-collapsed;
- importing a draft does not itself create an additional mailbox draft;
- the purpose of this path is to inspect / schedule / execute already-existing drafts, not to decide whether a new Initial Task should exist.

Therefore mailbox-draft imports bypass current-batch and mailbox-history dedupe. Other review rules (missing recipient, subject/body issues, attachment requirements, contact policy) remain independent.

## Manual mailbox freshness

Mailbox access remains operator-triggered. The Import dedupe card now exposes **读取最新邮箱**. It refreshes persisted Sent/Draft facts only when the operator clicks it; no background or implicit mailbox polling was reintroduced.

## Import gate behavior

For new Initial Tasks, a persisted complete manual mailbox snapshot is now a prerequisite. If the account has never been manually read, Import shows `邮箱历史待读取` and blocks Mail Review until the operator clicks `读取最新邮箱`. A previously saved manual snapshot can be reused; refreshing it is always explicit.
