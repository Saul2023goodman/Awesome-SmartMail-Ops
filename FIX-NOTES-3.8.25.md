# SmartMail Ops v3.8.25 — Global UI Density Fix

## Root cause fixed

The Review template content was correctly hidden in v3.8.24, but the board still used explicit fixed grid-row ownership. The hidden template/optional rows could therefore leave structural space between the command bar and the task board.

v3.8.25 changes the Review board to a content-driven vertical flex stack. Hidden utilities occupy zero space; visible utilities take only their natural height; the mail grid takes the remaining viewport immediately below the command bar.

## Global B2B UI pass

- Review board: no reserved rows for hidden template, subject prompt, or batch bar.
- Review cards: slightly denser 128 px operational cards.
- Preview: preserved two-pane rail + continuous document model, with tighter toolbar/rail chrome.
- Monitoring: stats, rules, filters, and rows compressed into a scan-first operations surface.
- Dispatch: reduced header/panel chrome and control heights; planning canvas receives more space.
- Import/classification: reduced framing padding while preserving decision surfaces.
- Shared page inset, border radius, typography, and semantic colors remain unified.

No business logic, review classification, runtime-only storage boundary, or execution contract changed.
