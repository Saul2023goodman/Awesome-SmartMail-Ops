# v3.8.81 · Follow-up monitor-all + 163 source jump

## Behavior changes

- Follow-up monitoring now always opens in **All** view and clears stale monitor filters/search when entering the monitoring page.
- Removed the per-conversation **Pause Follow-up / Resume Follow-up** action.
- Legacy `enabled:false` Follow-up policy overrides are normalized back to enabled so old hidden pause state cannot silently suppress future Follow-ups.
- Follow-up eligibility no longer has a `follow-up-disabled` branch. Contact-level recipient guards remain separate and still work.

## 163 original-message jump

- Added a reusable task -> 163 original-message resolver.
- Follow-up tasks resolve their parent outbound/provider message id directly.
- Initial tasks resolve linked outbound records; when legacy linkage is missing, SmartMail may use a **unique exact recipient + thread-subject** match. Ambiguous matches stay disabled rather than opening the wrong message.
- Added `163 原信件` actions to:
  - Follow-up monitoring rows
  - Review task cards
  - Review Preview headers
  - Dispatch schedule matrix tasks
  - Unscheduled/loose dispatch tasks
- Tasks with no resolvable 163 source show a disabled source action with an explanatory tooltip.
- All jumps use the existing `NMDA_OPEN_MAIL_MESSAGE` bridge and open Sent-folder messages with `fid=3`.

## Validation

- `node --check app.js`
- `node --check operations.js`
- `manifest.json` parse check
- compatibility smoke test confirms `{enabled:false}` can no longer disable Follow-up policy
