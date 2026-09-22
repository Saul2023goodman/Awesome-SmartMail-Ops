# SmartMail Ops 3.8.107 — Exact Time + Same-school Spacing

## Root cause

The scheduler treated an already-used **minute** as a global collision. When several unrelated schools were scheduled for 08:00, later tasks were silently shifted by `intraRoundMinutes` (historically 10 minutes), producing 08:10 / 08:20 even though NetEase does not require that separation.

There was also a cursor bug in the date loop: after finding a valid date, the loop incremented the internal day key once more before exiting. This could make a 7-day same-school interval behave like 8 days in subsequent planning metadata.

## Changes

- The operator-selected local send time is now authoritative. If the rule says **08:00**, every automatically scheduled task keeps **08:00** unless the operator explicitly edits that task.
- Removed automatic minute staggering and global exact-minute collision avoidance. Different schools may share the same date and minute.
- Restored **同校联系至少间隔** as an explicit scheduling rule, defaulting to **7 natural days** and configurable from 0–365 days.
- Same-school spacing is enforced against:
  - newly generated tasks,
  - protected/manual/fixed task times, and
  - existing NetEase scheduled drafts when mailbox schedule checking is enabled.
- Existing NetEase schedules only constrain the same institution; unrelated schools no longer shift or block one another because they use the same minute.
- Kept **每校同一天最多联系** as a separate rule. With interval = 0 and daily cap > 1, multiple same-school tasks may intentionally share the exact selected time.
- Added same-school interval conflict reporting to planning and pre-execution validation.
- Fixed the schedule date cursor so `scheduleDayKey`, displayed date, and actual scheduled timestamp stay aligned.

## Validation

Verified scheduler behavior for:

1. Alpha University and Beta University both schedule at `2026-09-23 08:00` with no minute shift.
2. Two Alpha University tasks with a 7-day gap schedule at `2026-09-23 08:00` and `2026-09-30 08:00`.
3. An existing NetEase draft at another school at `08:00` does not alter a new task's `08:00` schedule.
4. An existing NetEase draft at the same school enforces the configured day gap.
5. `same-school interval = 0` + `daily cap = 2` allows two same-school tasks at the exact same selected time.
6. All JavaScript files pass `node --check`; `manifest.json` validates.
