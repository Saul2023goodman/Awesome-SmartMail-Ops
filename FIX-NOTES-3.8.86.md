# v3.8.86 — 163 Compose paragraph spacing

- Added **段落间留空行** to the real 163 handoff controls; it is enabled by default and the operator preference is persisted locally.
- The rule is applied only at the final 163 Compose write boundary, so Review/task source content is not mutated.
- Rich HTML drafts now receive an idempotent blank editor row between adjacent top-level content blocks when no blank row already exists. Existing blank rows are preserved rather than duplicated.
- Plain-text drafts retain their existing `\n\n` paragraph spacing path.
- The same behavior applies to new messages and Follow-up Reply/Forward prepend flows.
