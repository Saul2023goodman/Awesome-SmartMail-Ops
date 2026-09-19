# v3.8.13 · Strict provider contracts and dead-code audit

- Removed speculative Sent-body fallbacks; `readhtml` is now the sole body source after `mbox:readMessage` metadata/context validation.
- Removed speculative Draft-detail fallbacks; `mbox:restoreDraft` is now the sole draft-detail source.
- Removed retired Contact migration, legacy preference bridge, hidden import/mapping/profile compatibility UI, stale direct mailbox message endpoints, and unused helpers/telemetry.
- Pruned unreachable SmartMail CSS selectors against the current DOM/class vocabulary.
- Preserved only alternate paths that correspond to observable NetEase UI/provider states or persisted pre-upgrade user data.
