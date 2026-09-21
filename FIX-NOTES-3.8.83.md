# v3.8.83 — Time Arrangement Guidance

- Promotes **设置时间安排** as the primary scheduling action instead of a generic time-planning button.
- Adds an actionable dispatch-page prompt whenever selected mail is still unscheduled.
- Rebuilds the schedule dialog around a three-step mental model: sending window → protection/avoidance → generate batch times.
- Marks the four key inputs explicitly: recipient region, start date, weekdays, and recipient-local send time.
- Adds live, non-mutating schedule preview: how many messages will receive generated times, how many existing times remain, estimated send-day count, and date span.
- Explains optional controls in user terms (same-school daily cap, existing 163 schedules, holidays, blackout range).
- The primary action now states the expected result, e.g. “生成 12 封邮件时间 · 保留 3 封 · 4 个发送日”.
- No scheduler semantics were changed; the redesign only improves comprehension and entry guidance.
