# NetEase Mail Draft Assistant v2.0 · Standalone UI QA

- Static / architecture checks: **PASS**
- Standalone runtime load: **PASS**
- Real import flow: **PASS**
- Attachment-vault API loaded: **PASS** (real IndexedDB storage requires extension origin; this sandbox blocks navigable local origins)

## Responsive screenshots

| Viewport | P0 | P1 | Screenshot |
|---|---:|---:|---|
| desktop-wide 1440×900 | 0 | 0 | `qa/screenshots/v2-preflight-desktop-wide-1440x900.png` |
| desktop 1280×800 | 0 | 0 | `qa/screenshots/v2-preflight-desktop-1280x800.png` |
| compact 1100×760 | 0 | 0 | `qa/screenshots/v2-preflight-compact-1100x760.png` |
| narrow 920×720 | 0 | 0 | `qa/screenshots/v2-preflight-narrow-920x720.png` |
| minimum 820×700 | 0 | 0 | `qa/screenshots/v2-preflight-minimum-820x700.png` |

## Findings

- 自动布局检查未发现 P0/P1 问题。

## Architecture assertions

- `app.html/app.js` owns the visible workflow.
- `executor.js` is the only script injected into `mail.163.com`; it contains no workbench UI.
- `background.js` owns tab routing and mailbox-state reads.
- `file-vault.js` bridges local attachments through IndexedDB instead of attempting to serialize `File` objects through Chrome messages.
- The old floating `content.js/content.css` host UI is not part of the v2 package.
