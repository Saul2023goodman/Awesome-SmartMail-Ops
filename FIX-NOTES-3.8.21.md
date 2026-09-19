# v3.8.21 · Continuous Preview Review

- Review no longer uses a card grid as the primary reading surface.
- Initial and Follow-up mails render as full-width document sheets in one vertically scrolling canvas, inspired by continuous document preview workflows.
- Each sheet shows recipient, subject, source kind, review state, issues, and the complete body without an inner scroll area.
- Clicking the sheet itself no longer opens a single-mail detail state. Only the explicit `修正/补齐` control opens the focused correction editor.
- `去审阅` from Mail Monitoring now opens Review and scrolls to the corresponding Follow-up sheet instead of replacing the canvas with one message.
- `跳到下一个需处理` scrolls to the next pending sheet rather than opening it alone.
- Review rendering is chunked at 32 full messages and extends automatically near the bottom to keep large batches responsive.
- Existing automatic review, batch confirmation, filtering, search, and dispatch gating are unchanged.
- The focused editor remains available only as a correction inspector and no longer represents the normal Review reading mode.
