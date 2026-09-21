# v3.8.99 — Mail Monitoring Decision Tree

- Rebuilt Mail Monitoring around the real Follow-up decision order instead of a flat status table.
- Added a user-facing overview tree: sent → reply? → scheduled? → due? → prepare Follow-up.
- Each monitored conversation now renders the exact path it took, with only business-facing language.
- Kept existing eligibility, mailbox sync, review, dispatch, cancellation, manual reply classification, and batch Follow-up actions intact.
- Reframed summary counts and filters around user actions: now due, waiting, scheduled, human / needs judgment.
- Technical mailbox implementation details remain hidden from the primary monitoring surface.
