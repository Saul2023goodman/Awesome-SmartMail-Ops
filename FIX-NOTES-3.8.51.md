# SmartMail Ops 3.8.51 — Priority Round / Schedule Separation

## Correct semantic model

- `R1 / R2 / R3 …` now means **within-school contact priority only**.
- A priority round never means “the first/second/third calendar scheduling cycle”.
- Scheduling remains a separate concern driven by start time, same-school interval, capacity, holidays/weekends, fixed times, and existing NetEase schedules.

## Behaviour changes

1. The roster planner is presented as **优先轮次** rather than 名单分批.
2. Generic spreadsheet headers such as `批次 / 发送批次 / batch / wave` are no longer auto-interpreted as priority rounds. Explicit round headers such as `轮次 / 优先轮次 / round` still are.
3. Priority rounds only sort contacts within the same institution. A standalone R3 can use the institution’s earliest available schedule slot; it is not forced into schedule cycle 3.
4. Different institutions are independent. An R2 contact at School A does not delay an R2 contact at School B.
5. Fixed or already-scheduled mail must not invert priority. If R1 is fixed later, R2 is placed after it. If a fixed lower-priority contact makes the required order impossible, scheduling stops with an explicit priority conflict.
6. The scheduling UI no longer labels calendar columns R1/R2. It uses **排期周期 / 排期 N / date** so R labels are reserved for roster priority.

## Compatibility

Persisted 3.8.x manual `batch / roundIndex` roster intents are migrated into `priorityRoundLabel / priorityRoundIndex`. Legacy aliases are retained internally for workspace compatibility but are not used to pin calendar dates.
