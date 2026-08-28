# v2.5 QA Runtime Ready

- Version: `2.5.0`
- UI architecture: Mail Status Board + scoped dialogs
- Standalone workspace load: PASS
- Real import: PASS
- Stage navigation/isolation: PASS
- Planning → review status board → return to planning: PASS
- Review board starts without auto-opening a mail: PASS
- Single-mail intervention dialog: PASS
- Schedule settings modal: PASS
- Contacts compact list + detail modal: PASS
- Responsive baselines: 1440×900 / 1280×800 / 1100×760 / 920×720 / 820×700 / 1366×611
- Automated layout result: P0 = 0 / P1 = 0

Run:

```bash
python3 qa/ui_audit.py
```
