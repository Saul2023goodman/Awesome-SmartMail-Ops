# v3.8.12 · NetEase readhtml Sent-body fix

- Corrected the Follow-up Initial-body hydration model: `mbox:readMessage` is treated as the metadata/context request, while the actual message body is loaded from NetEase MailReader's separate `readhtml` document.
- The body URL now mirrors NetEase source behavior: use `read/readhtml3.jsp?mid=...` when `$.Ext.read_noSsidRead` is enabled; otherwise use `$G.environment.readUrl` with the message id. A relative `readhtml3.jsp` URL remains a defensive fallback.
- The returned HTML is parsed from `template#contentTemplate` → `[data-ntes="ntes_mail_body_root"]`, matching the real provider response captured from 163 Mail.
- `<br>` and block boundaries are converted to stable line breaks before deterministic salutation/signature extraction.
- Successful body hydration is persisted into the root Initial outbound snapshot, so later Follow-up generation reuses the cached content.
- `readMessage.var.html.content / var.text.content` is retained only as a compatibility fallback for alternate provider deployments.
- Diagnostics now separate `sent-readhtml-failed` from `sent-readhtml-parse-failed` rather than incorrectly reporting `initial-body-missing`.
