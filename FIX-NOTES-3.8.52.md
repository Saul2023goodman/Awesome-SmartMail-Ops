# SmartMail Ops 3.8.52 — Optional Priority Rounds

## Correct readiness model

Priority rounds are **optional within-school ordering metadata**. They are not a prerequisite for scheduling or execution.

- School/institution grouping is used by the scheduler for same-school spacing rules.
- `R1 / R2 / R3 ...` is only consulted when the operator explicitly provides it.
- Contacts with no priority round remain valid scheduling candidates.
- A school may have no rounds at all, or only some contacts annotated with rounds.

## Fixes

1. Removed the priority-round readiness gate from opening Time Rules.
2. Removed the priority-round readiness gate from applying automatic scheduling.
3. Removed the priority-round readiness gate from starting NetEase execution.
4. Removed the scheduler exception that rejected contacts without R1/R2/R3.
5. `priorityRoundRequired` / legacy `batchRequired` are now persisted as `false` for compatibility.
6. Removed the obsolete unassigned-round blocking helper chain so it cannot be accidentally re-used as a gate.
7. UI now marks priority rounds as **可选** and shows unassigned contacts as **未设置 · 可选**, not as an error/to-do state.
8. Scheduling copy now states that rounds are applied only when present.

## Ordering behaviour

- No priority rounds: schedule normally using the existing task/list order and scheduling rules.
- Explicit priority rounds: annotated contacts are ordered by R1 → R2 → R3 within the same school.
- Partial annotation is allowed; unannotated contacts do not block scheduling.
- A standalone R3 still uses the earliest available schedule cycle for that school; R3 is not calendar cycle 3.
- Existing/fixed schedules still enforce explicit priority constraints when such constraints are present.
