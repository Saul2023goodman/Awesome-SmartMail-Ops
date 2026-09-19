# v3.8.9 · Unified Mail Dock

- Replaced the full-height right-side SmartMail rail with one compact bottom-right launcher so the NetEase message date/time column is no longer covered by a persistent vertical overlay.
- Removed the separate fixed batch execution monitor from `executor.js`.
- Execution state is now rendered inside the same SmartMail dock as workflow, monitoring, and connection status.
- During execution the launcher displays progress; opening it defaults to the Execution view.
- Execution keeps the existing stop-after-current-message action and route back to Selection & Scheduling.
- The unified panel only expands on explicit click (or Alt+M); it no longer opens on hover.
