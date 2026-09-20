# SmartMail Ops v3.8.28 — Existing Schedule Anchors

## Read existing NetEase schedules before planning

Selection & Scheduling now has a default-on optional rule: `纳入网易已有排期`.

When enabled, every Apply / Re-apply operation performs a fresh read-only scan of the NetEase Draft mailbox and extracts future scheduled drafts. The scan does not restore, edit, cancel, reschedule, or save any existing draft.

Existing scheduled drafts enter the scheduler as immutable anchors:

- their scheduled time is locked;
- their institution / recipient group consumes the corresponding round capacity when it can be determined deterministically;
- a new task is moved to a later legal round when the same-school allowance is already consumed;
- a new task whose proposed minute collides with a locked scheduled draft is shifted to the next available scheduler slot;
- existing anchors themselves are never changed, even when they already violate the current SmartMail rule.

School association for an anchor is deterministic. SmartMail first uses an exact recipient match against the current queue, then a unique recipient-domain → school mapping from the current queue. If neither is unique, the scheduler keeps the provider/domain-level grouping and does not guess a school.

## Fail closed

If `纳入网易已有排期` is enabled and the Draft mailbox scan fails or is incomplete, SmartMail does not silently assume an empty mailbox. Schedule generation stops until the read succeeds or the operator explicitly disables the option.

Before batch execution, SmartMail reads the current scheduled-draft anchors again. If the mailbox has changed and the frozen current schedule now collides with an immutable anchor, execution is blocked and the operator is asked to re-apply scheduling.

## Runtime-only boundary

The fetched anchors are runtime facts only. They are kept in the current app page memory and disappear on reload/close. The checkbox is a reusable scheduling preference and may persist with the other scheduling-rule preferences.

Provider scheduled drafts that are already represented inside the current batch remain locked even if `保留本批已有时间` is disabled. The provider-owned schedule is not treated as a movable SmartMail time.
