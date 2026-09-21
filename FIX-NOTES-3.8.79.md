# v3.8.79 — Review empty-state rebuild

- Treat zero Review tasks as a dedicated empty state instead of a normal Review board filled with zero-count controls.
- Hide status tabs, batch processing, search, trash/next actions, preview controls, queue, and format dock while Review is empty.
- Add a centered empty-state surface with clear explanation and two valid next actions: return to Import or open Mail Monitoring.
- Keep the normal Review UI unchanged as soon as any Initial or Follow-up task exists.
- Update the Review header subtitle to `暂无审阅任务` when empty.
