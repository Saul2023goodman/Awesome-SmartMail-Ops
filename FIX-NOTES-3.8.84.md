# v3.8.84 — Mailbox history defaults to all mail

- Changed the mailbox history default from recent 6 months to **all mail** (`historyMonths = 0`).
- Moved “全部邮件” to the first option in the history-range selector so the UI matches the default behavior.
- Fresh installs and “清空全部” resets now return to all-mail history instead of 6 months.
- Explicitly selected finite ranges (3 / 6 / 9 / 12 / 18 / 24 months) remain available.
