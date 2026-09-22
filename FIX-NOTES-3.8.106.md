# Fix Notes 3.8.106 — Contact-first outcome dashboard

## Added
- Added **成效看板** as a first-class workspace beside Import / Review / Dispatch.
- Dashboard measures service delivery by unique contacts rather than raw email count.
- Added institution breadth, Follow-up persistence, ongoing manual conversation, and multi-round conversation signals.
- Added a high-signal conversation spotlight that visually prioritizes rare ongoing exchanges instead of centering low reply rates.
- Added an Outreach Field where each dot represents a contact; planned, reached, followed-up, replied, ongoing, and multi-round contacts use progressively stronger visual weight.
- Added cumulative delivery trajectory with Follow-up and human-reply evidence markers.
- Added outreach-depth evidence using deterministic Initial / Follow-up history and the active Follow-up policy.
- Added Operator / 学生展示 modes. Student mode hides mailbox-level identifiers and execution affordances while preserving factual service evidence.

## Measurement rules
- Automatic replies are not counted as human response outcomes.
- The dashboard never infers positive/negative reply sentiment.
- `持续往来` is deterministic: a human reply has been observed and the operator subsequently sent another outbound message.
- `多轮往来` requires ongoing operator continuation plus at least two observed human replies.
- When a current target pool is loaded, contract/delivery coverage is scoped to that pool; otherwise mailbox contact history becomes the visible scope.
- Unreplied contacts are shown as neutral background activity, not red failures.
