# 3.8.72 — Mailbox history window

- Removed the half-year Follow-up reactivation rule entirely.
- Added a mailbox history read window in Mail Monitoring. Default: recent 6 months; selectable 3 / 6 / 9 / 12 / 18 / 24 months or all mail.
- The cutoff is enforced while paging NetEase `mbox:listMessages`: once the date boundary is reached, older pages are not requested.
- The same window applies to Sent, Drafts, Inbox, duplicate-history checks, scheduled-draft discovery, reply association, and Follow-up history.
- Changing the window performs a scoped full rebuild so mailbox facts outside the new range are removed from the runtime store and no longer affect duplicate detection or Follow-up sequencing.
- A new academic-year contact therefore starts cleanly once previous correspondence falls outside the selected history window.
