# v3.8.15 · Follow-up Review Editor Routing Fix

- Fixed Follow-up cards in Mail Review being visible but not opening.
- Root cause: the delegated Review click handler still resolved cards only from `batch.tasks`; Follow-up Derived Tasks live in the operation store and therefore always missed that lookup.
- Review card opening now resolves through `reviewTaskByKey`, the unified Initial + Follow-up adapter.
- Search/navigation refresh now also resolves the active item through the unified Review registry.
- Recipient/body/subject change handlers now refresh Follow-up audit state through the unified registry instead of Initial-only lookups.
- Follow-up subject edits no longer trigger the Initial-only “fill the same subject into other missing-subject mails” assistant.
- No domain-state change: Follow-up remains `prepared` until Review Pass, then receives exact-version confirmation and enters Dispatch.
