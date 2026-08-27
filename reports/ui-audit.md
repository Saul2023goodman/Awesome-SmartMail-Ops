# NetEase Mail Draft Assistant · Automated UI QA

- Version: `1.47.0`
- Static checks: **PASS**
- Runtime import: **PASS**
- Imported routing: ✉ · 邮件 · 1 · 名 · 总名单 · 1 · 附 · 附件 · 1 · ! · 待确认 · 0 · × · 暂不使用 · 0

## Viewport results

| Viewport | P0 | P1 | P2 | Small text <9px | Nested scroll | Screenshot |
|---|---:|---:|---:|---:|---:|---|
| desktop-wide 1440×900 | 5 | 0 | 2 | 16 | 0 | `10-preflight-desktop-wide-1440x900.png` |
| desktop 1280×800 | 5 | 0 | 2 | 16 | 0 | `10-preflight-desktop-1280x800.png` |
| compact 1100×760 | 5 | 0 | 2 | 14 | 0 | `10-preflight-compact-1100x760.png` |
| narrow 920×720 | 5 | 0 | 2 | 14 | 0 | `10-preflight-narrow-920x720.png` |
| minimum 820×700 | 5 | 0 | 2 | 11 | 0 | `10-preflight-minimum-820x700.png` |

## Findings

- **P0 · desktop-wide** `fixed-modal-contained-by-layout` — fixed 遮罩没有以视口为包含块；祖先布局隔离使其被限制在工作区内（section.nmda-tabpane.nmda-page.nmda-ingest-page contain=layout style）。
- **P0 · desktop-wide** `dialog-wider-than-backdrop` — 分类弹窗宽度 1208px 大于遮罩可用宽度 1150px。
- **P0 · desktop-wide** `dialog-outside-viewport` — 分类弹窗超出视口。
- **P0 · desktop-wide** `footer-outside-viewport` — 分类弹窗底部操作区超出视口。
- **P0 · desktop-wide** `control-outside-viewport` — 3 个可交互控件超出视口。
- **P2 · desktop-wide** `dense-small-text` — 当前弹窗有 16 处小于 9px 的直接文本，阅读密度偏高。
- **P2 · desktop-wide** `small-hit-target` — 当前弹窗有 2 个交互目标小于 28×26px。
- **P0 · desktop** `fixed-modal-contained-by-layout` — fixed 遮罩没有以视口为包含块；祖先布局隔离使其被限制在工作区内（section.nmda-tabpane.nmda-page.nmda-ingest-page contain=layout style）。
- **P0 · desktop** `dialog-wider-than-backdrop` — 分类弹窗宽度 1208px 大于遮罩可用宽度 1046px。
- **P0 · desktop** `dialog-outside-viewport` — 分类弹窗超出视口。
- **P0 · desktop** `footer-outside-viewport` — 分类弹窗底部操作区超出视口。
- **P0 · desktop** `control-outside-viewport` — 7 个可交互控件超出视口。
- **P2 · desktop** `dense-small-text` — 当前弹窗有 16 处小于 9px 的直接文本，阅读密度偏高。
- **P2 · desktop** `small-hit-target` — 当前弹窗有 2 个交互目标小于 28×26px。
- **P0 · compact** `fixed-modal-contained-by-layout` — fixed 遮罩没有以视口为包含块；祖先布局隔离使其被限制在工作区内（section.nmda-tabpane.nmda-page.nmda-ingest-page contain=layout style）。
- **P0 · compact** `dialog-wider-than-backdrop` — 分类弹窗宽度 1066px 大于遮罩可用宽度 876px。
- **P0 · compact** `dialog-outside-viewport` — 分类弹窗超出视口。
- **P0 · compact** `footer-outside-viewport` — 分类弹窗底部操作区超出视口。
- **P0 · compact** `control-outside-viewport` — 8 个可交互控件超出视口。
- **P2 · compact** `dense-small-text` — 当前弹窗有 14 处小于 9px 的直接文本，阅读密度偏高。
- **P2 · compact** `small-hit-target` — 当前弹窗有 2 个交互目标小于 28×26px。
- **P0 · narrow** `fixed-modal-contained-by-layout` — fixed 遮罩没有以视口为包含块；祖先布局隔离使其被限制在工作区内（section.nmda-tabpane.nmda-page.nmda-ingest-page contain=layout style）。
- **P0 · narrow** `dialog-wider-than-backdrop` — 分类弹窗宽度 886px 大于遮罩可用宽度 696px。
- **P0 · narrow** `dialog-outside-viewport` — 分类弹窗超出视口。
- **P0 · narrow** `footer-outside-viewport` — 分类弹窗底部操作区超出视口。
- **P0 · narrow** `control-outside-viewport` — 8 个可交互控件超出视口。
- **P2 · narrow** `dense-small-text` — 当前弹窗有 14 处小于 9px 的直接文本，阅读密度偏高。
- **P2 · narrow** `small-hit-target` — 当前弹窗有 2 个交互目标小于 28×26px。
- **P0 · minimum** `fixed-modal-contained-by-layout` — fixed 遮罩没有以视口为包含块；祖先布局隔离使其被限制在工作区内（section.nmda-tabpane.nmda-page.nmda-ingest-page contain=layout style）。
- **P0 · minimum** `dialog-wider-than-backdrop` — 分类弹窗宽度 786px 大于遮罩可用宽度 604px。
- **P0 · minimum** `dialog-outside-viewport` — 分类弹窗超出视口。
- **P0 · minimum** `footer-outside-viewport` — 分类弹窗底部操作区超出视口。
- **P0 · minimum** `control-outside-viewport` — 6 个可交互控件超出视口。
- **P2 · minimum** `dense-small-text` — 当前弹窗有 11 处小于 9px 的直接文本，阅读密度偏高。
- **P2 · minimum** `small-hit-target` — 当前弹窗有 2 个交互目标小于 28×26px。

## What this harness verifies

- Executes the production `content.js` / import stack and `content.css` in Chromium.
- Drives the real multi-file import path into the classification dialog.
- Captures responsive screenshots at five viewport sizes.
- Flags viewport escape, footer loss, header/list overflow, overlapping controls, nested vertical scroll contexts, suspicious clipping, very small text, and undersized hit targets.
- Does not change production parsing, scheduling, contacts, or draft-creation logic.

## Re-run

```bash
python3 qa/ui_audit.py
```

For before/after visual diffs, preserve an older screenshot folder and run:

```bash
python3 qa/ui_audit.py --baseline /path/to/old/qa/screenshots
```
