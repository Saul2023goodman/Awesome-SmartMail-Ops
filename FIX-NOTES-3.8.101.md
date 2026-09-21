# v3.8.101 — Monitor scrolling + clearer contact summary language

- Fixed Utilities/Mail Monitoring vertical scrolling. `ui-system.css` locks generic `.nmda-page` overflow; the Utilities page now explicitly owns vertical scrolling with a higher-specificity rule.
- Kept the monitor body content-sized to avoid nested/double scroll containers.
- Replaced the confusing “每个邮箱只看一个运营状态” wording with “按联系人汇总当前进展”.
- Added explicit clarification that historical emails remain available and the overview only summarizes each contact’s current stage.
- Updated manifest version and description to match the contact-centric behavior.
