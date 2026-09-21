# v3.8.80 · Smart Time Field

## Goal
Unify every cumbersome time-setting surface around one low-friction component instead of adding a different date/time control per page.

## Component decision
Use a hybrid **Smart Time Field**: keep the native input for exact keyboard entry and browser date/time selection, then add one compact quick-set trigger for common choices. This avoids the two bad extremes of a calendar-only UI (too many clicks) and a preset-only UI (not precise enough).

## Applied surfaces
- Schedule start date: 今天 / 明天 / 下个发送日 / +1 周.
- Local send time: 07:30 / 08:00 / 09:00 / 10:00 / 13:30.
- Skip-range start/end: quick relative dates plus clear.
- Per-message datetime in the planning matrix: shift +1 day, next allowed send day, +1 week, restore rule time, clear.
- Follow-up delay: 3 / 5 / 7 / 10 / 14 days.

## Preserved controls
- Region/timezone selector remains a select because it is already the fastest precise control.
- Weekdays remain toggle chips.
- Mailbox history range remains a select.

## Behavior
- Quick choices dispatch the same input/change events as manual edits, so existing scheduling and Follow-up logic remains authoritative.
- Native picker stays available through “打开选择器”.
- Smart popover closes on Escape, outside click, scroll, or planning lock.
- Existing mailbox-scheduled timestamps remain read-only.
