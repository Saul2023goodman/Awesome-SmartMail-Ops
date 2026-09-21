# v3.8.78 — Follow-up Monitor Redesign

- Rebuilt Mail Monitoring around a single action-first summary: **现在可以准备跟进**.
- Removed the collapsible Follow-up template block from the monitoring page.
- Added explicit **跟进规则** and **正文模板** buttons that open a focused settings dialog.
- Reworked Follow-up rule controls into three user-facing concepts: wait interval, max attempts, and compose mode.
- Kept template editing focused on the middle body only; salutation/signature remain inherited from Initial.
- Consolidated waiting, scheduled, replied, and attention counts into a compact status surface.
- Reworked batch Follow-up creation into a clear action strip under filters.
- Updated wording so users see actionable next steps rather than internal “Follow-up #N due” terminology.
