# v3.8.17 · ReadHTML fragment contract fix

- Compared a successful NetEase `readhtml3.jsp` response with a failing response.
- Confirmed two real provider body serializations: standard Compose HTML with `data-ntes="ntes_mail_body_root"`, and Word/Office HTML (`MsoNormal`, `o:p`) without that attribute.
- Corrected the provider contract: the complete `template#contentTemplate.content` fragment is the authoritative rendered message body because NetEase itself appends that entire fragment into `#content`.
- Removed the false requirement that a body must contain `[data-ntes="ntes_mail_body_root"]`; this is not a fallback path.
- Reworked HTML-to-text conversion to follow rendered whitespace semantics: source wrapping inside inline Office spans collapses to spaces, while `<p>`, `<div>`, `<br>`, list items, headings, rows, and blockquotes preserve semantic breaks.
- Follow-up salutation/signature extraction therefore receives stable plain text for both standard Compose and Word/Office-origin messages.
