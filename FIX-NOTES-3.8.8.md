# v3.8.8 · Template-driven Follow-up generation

- Follow-up configuration now owns a reusable middle-body template.
- Salutation (for example `Dear …`) and signature are copied deterministically from the root Initial email, not guessed from roster data.
- If the Initial body is not already available locally, SmartMail reads that specific Sent message detail on demand when generating Follow-up tasks.
- Batch generation creates confirmed Derived Follow-up Tasks from the saved template and places them directly in Selection & Scheduling.
- The per-Follow-up editor, save, confirm, and queue steps were removed.
- Existing legacy unconfirmed Follow-up tasks are not rewritten; cancel them to regenerate from the current template. Existing confirmed/queued tasks retain their authorized content.
- A saved template is versioned; each generated task records the template version and extracted salutation/signature snapshot used to create it.
