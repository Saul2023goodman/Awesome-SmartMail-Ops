# v3.8.11 · Sent body hydration fix

- Follow-up Initial-body hydration now uses NetEase WebMail's own `module.read.ReadAction.readMessage` request contract first (`mbox:readMessage` with `id`, headers and reader options), with the native minimal `{id}` form retained as a compatibility fallback.
- The response parser now prefers the actual NetEase MailReader schema: `response.var.html.content` and `response.var.text.content`. A defensive compatibility scan is used only when those fields are absent.
- `response.code` is checked against NetEase `$.S_OK`; failed provider reads are no longer silently treated as missing local content.
- Successful Sent body reads are persisted back into the root Initial `outboundRecord`, so later Follow-up generation reuses the cached content without another read.
- Hydration failures are persisted as diagnostic facts and separated into `initial-provider-id-missing`, `sent-read-unavailable`, `sent-read-failed`, `sent-read-empty`, and `sent-body-parse-failed`.
- Single and batch template generation now surface the real hydration failure instead of collapsing everything into `initial-body-missing`. Batch generation continues for roots that hydrate successfully and skips only failed roots.
- Salutation/signature extraction remains deterministic and runs only after a real Initial body is available.
