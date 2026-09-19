# v3.8.22 · Card board + continuous Preview

- Restored the original high-density Review card grid as the default Review surface.
- Opening a card now enters a continuous Preview reader instead of opening the single-mail editor.
- Continuous Preview renders the whole currently filtered Review set vertically and scrolls to the card that was opened.
- Preview reuses the established semantic key-information markers directly inside recipient, subject, and full body text: advisor, student, institution, semantic anchors, and degree/time signals.
- Preview no longer extracts or renders separate opening/closing excerpts. The complete message remains the single reading surface.
- Explicit `修正 / 补齐` inside Preview opens the focused correction inspector for that mail; closing the inspector returns to the same Preview position/surface.
- Added an explicit `返回卡片` action and compact semantic marker legend to the Preview toolbar.
- `跳到下一个需处理` opens Preview when invoked from the card board, then scrolls between pending messages rather than forcing one-by-one editing.
