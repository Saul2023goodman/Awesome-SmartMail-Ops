# v3.8.18 · Human-managed conversation fix

- Fixed a lineage bug where manual operator Sent messages after a real human reply were auto-adopted as fresh Initial roots and incorrectly became Follow-up eligible.
- Human replies now close automation for the entire deterministic conversation (exact recipient set + normalized subject thread key), even when later manual Sent messages exist.
- Mail Monitoring collapses duplicate roots in a human-managed conversation into one row and labels later outbound activity as manual communication.
- Follow-up eligibility checks conversation-level human evidence before starting a new timer.
- Existing pending Follow-up tasks become blocked by the human conversation; queued tasks are automatically dequeued and blocked tasks are excluded from Dispatch.
- Automatic replies remain non-blocking; ambiguous replies remain reversible blockers; a genuinely new subject starts a separate outreach conversation.
- Fixed the block-refresh path so nested store normalization no longer replaces task objects while they are being updated.
