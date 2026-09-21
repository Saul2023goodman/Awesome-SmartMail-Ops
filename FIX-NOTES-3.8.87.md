# v3.8.87 — Remove false body-boundary manual review

- Body-boundary parser diagnostics no longer create a manual Review gate.
- Suppressed from unresolved Review issues: missing standard salutation/closing, low body-boundary confidence, and isolated ambiguous tail content.
- Diagnostics remain stored in import metadata for traceability.
- Actionable blockers remain unchanged: invalid/missing recipient, missing subject/body, recipient ambiguity, roster/contact conflicts, manual-edit pending states, and other explicit review issues.
- Removed the generic low-confidence-only `请检查邮件内容` gate so parser confidence alone cannot force operator confirmation.
