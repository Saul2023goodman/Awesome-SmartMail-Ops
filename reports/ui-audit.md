# NetEase Mail Draft Assistant v2.3 · Adaptive Canvas UI QA

- Static / architecture checks: **PASS**
- Standalone runtime load: **PASS**
- Real import flow: **PASS**
- Stage navigation / isolation: **PASS**
- Import stage content isolation: **PASS**
- Attachment-vault API loaded: **PASS** (real IndexedDB storage requires extension origin; this sandbox blocks navigable local origins)

## Responsive screenshots

| Viewport | P0 | P1 | Screenshot |
|---|---:|---:|---|
| desktop-wide 1440×900 | 0 | 0 | `qa/screenshots/v2-preflight-desktop-wide-1440x900.png` |
| desktop 1280×800 | 0 | 0 | `qa/screenshots/v2-preflight-desktop-1280x800.png` |
| compact 1100×760 | 0 | 0 | `qa/screenshots/v2-preflight-compact-1100x760.png` |
| narrow 920×720 | 0 | 0 | `qa/screenshots/v2-preflight-narrow-920x720.png` |
| minimum 820×700 | 0 | 0 | `qa/screenshots/v2-preflight-minimum-820x700.png` |
| short-desktop 1366×611 | 0 | 0 | `qa/screenshots/v2-preflight-short-desktop-1366x611.png` |

## Stage / module screenshots

| View | P0 | P1 | Screenshot |
|---|---:|---:|---|
| materials-roster-desktop 1440×900 | 0 | 0 | `qa/screenshots/v2-materials-roster-desktop-1440x900.png` |
| materials-roster-minimum 820×700 | 0 | 0 | `qa/screenshots/v2-materials-roster-minimum-820x700.png` |
| materials-attachment-desktop 1440×900 | 0 | 0 | `qa/screenshots/v2-materials-attachment-desktop-1440x900.png` |
| materials-attachment-minimum 820×700 | 0 | 0 | `qa/screenshots/v2-materials-attachment-minimum-820x700.png` |
| import-loaded-desktop 1440×900 | 0 | 0 | `qa/screenshots/v2-import-loaded-desktop-1440x900.png` |
| import-loaded-minimum 820×700 | 0 | 0 | `qa/screenshots/v2-import-loaded-minimum-820x700.png` |
| planning-desktop 1440×900 | 0 | 0 | `qa/screenshots/v2-planning-desktop-1440x900.png` |
| planning-minimum 820×700 | 0 | 0 | `qa/screenshots/v2-planning-minimum-820x700.png` |
| planning-short-desktop 1366×611 | 0 | 0 | `qa/screenshots/v2-planning-short-desktop-1366x611.png` |
| mail-times-desktop 1440×900 | 0 | 0 | `qa/screenshots/v2-mail-times-desktop-1440x900.png` |
| mail-times-minimum 820×700 | 0 | 0 | `qa/screenshots/v2-mail-times-minimum-820x700.png` |
| mail-times-short-desktop 1366×611 | 0 | 0 | `qa/screenshots/v2-mail-times-short-desktop-1366x611.png` |
| create-desktop 1440×900 | 0 | 0 | `qa/screenshots/v2-create-desktop-1440x900.png` |
| create-minimum 820×700 | 0 | 0 | `qa/screenshots/v2-create-minimum-820x700.png` |
| single-desktop 1440×900 | 0 | 0 | `qa/screenshots/v2-single-desktop-1440x900.png` |
| single-minimum 820×700 | 0 | 0 | `qa/screenshots/v2-single-minimum-820x700.png` |
| contacts-desktop 1440×900 | 0 | 0 | `qa/screenshots/v2-contacts-desktop-1440x900.png` |
| contacts-minimum 820×700 | 0 | 0 | `qa/screenshots/v2-contacts-minimum-820x700.png` |

## Findings

- 自动布局检查未发现 P0/P1 问题。

## Architecture assertions

- `app.html/app.js` owns the visible workflow.
- `executor.js` is the only script injected into `mail.163.com`; it contains no workbench UI.
- `background.js` owns tab routing and mailbox-state reads.
- `file-vault.js` bridges local attachments through IndexedDB instead of attempting to serialize `File` objects through Chrome messages.
- The old floating `content.js/content.css` host UI is not part of the v2 package.
