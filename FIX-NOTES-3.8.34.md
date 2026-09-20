# SmartMail Ops v3.8.34 — Execution Preflight Attention

## Why
The Dispatch footer previously rendered `未定时` / `无附件` as tiny fact chips. In a dense planning screen those states were too easy to miss immediately before execution.

## Changes
- Added a dedicated execution-preflight attention layer directly below the schedule/send status.
- `未定时`: shows the exact number of affected selected-ready mails and explains that they will be created as ordinary drafts instead of following a scheduled send time.
- `无附件`: shows the exact number of affected mails; when all selected mails are attachmentless it explicitly marks the state as `全部`.
- Alerts use restrained warm tones, a left semantic accent, and matching outline icons instead of error-red treatment.
- The attention layer appears only when a relevant condition exists; otherwise it collapses to a compact `执行检查通过` state.
- When the warning signature changes, the alert enters once with a short rise/settle + gradient-sweep motion. `prefers-reduced-motion` is respected.
- The warning remains informational and does not block execution, because an unscheduled draft or an attachmentless mail can be intentional.
- Replaced the remaining `N` execution mark with the unified SmartMail route glyph.

## Risk calculation
- Unscheduled count = selected, ready tasks minus selected tasks with `scheduleAt`.
- Attachmentless count = selected, ready tasks whose runtime `files` array is empty.

All v3.8.33 card-collision fixes and v3.8.32 automatic handoff/mailbox-sync behavior are retained.
