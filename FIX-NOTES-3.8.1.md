# v3.8.1 — Review → Dispatch handoff fix

This patch repairs the batch-review handoff introduced by the v3.8.0 dispatch architecture split.

- All review completion paths now converge on the same handoff gate.
- Finishing the last review item automatically marks the batch ready and opens **Selection & Scheduling**.
- Individual review save, direct missing-field repair, duplicate-group decisions, exclusion and bulk confirmation now share the same transition semantics.
- The review header keeps an explicit **进入选择与排期** action when there are no remaining review items, so users can re-enter Dispatch after returning to Review.
- Follow-up dispatch architecture and manual mailbox monitoring are unchanged.
