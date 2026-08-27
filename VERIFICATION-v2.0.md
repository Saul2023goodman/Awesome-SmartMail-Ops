# Verification · v2.0

## Passed in the automated harness

- JavaScript syntax: app / background / executor / file-vault / parser / contacts / scheduler / roster.
- 20 source-role, mail-frame and source-isolation regression cases.
- Production import flow with Word + Excel + PDF QA fixtures.
- Independent app default-open/full-viewport behavior.
- Five responsive classification screenshots: 1440×900, 1280×800, 1100×760, 920×720, 820×700.
- P0/P1 automated layout findings: 0 / 0.
- Attachment-vault API surface and chunking code are loaded and syntax-checked.

## Environment boundary

The current automated Chromium sandbox blocks navigation to local and `chrome-extension://` origins, so it cannot reproduce a signed-in personal NetEase session. The true final transaction — executor operating an authenticated `mail.163.com` tab and IndexedDB sharing between extension page/service worker — must be smoke-tested once in the user's normal Chrome after loading the unpacked extension. The architecture is wired for that path; the sandbox does not provide the login/session surface needed to complete it here.
