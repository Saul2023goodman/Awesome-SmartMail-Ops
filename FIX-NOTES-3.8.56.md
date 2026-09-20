# v3.8.56 — Format Fidelity Chain

## Product rule

Formatting is part of the authored mail, not disposable decoration. SmartMail now keeps portable, meaningful formatting from source import through review and final NetEase composition while continuing to normalize unsafe or presentation-only styling.

## Import

- HTML mail sources preserve italic, bold, underline, strike-through, safe links and line breaks.
- DOCX mail paragraphs preserve Word run emphasis (italic/bold/underline/strike) instead of flattening every run to plain text.
- Recognized mail frames now carry `bodyHtml`, `bodyIsHtml` and compact format-feature evidence in row metadata, so multi-file Word merges keep the same representation.
- Arbitrary CSS, scripts, event attributes, images and unsafe link schemes are not imported into executable mail HTML.

## Review / preview

- Continuous Preview and the full-mail audit render the preserved rich body instead of flattening it into `<pre>` text.
- Existing semantic markers still locate advisor, student, institution, salutation/intention/signature and degree/time cues.
- Original emphasis is now an additional attention feature: italic, bold, underline, strike-through and links receive a restrained format marker without replacing their native typography.
- The legend adds “原始格式” and dynamically reports which formatting features exist in the current mail.

## Editing

- Plain textarea editing is replaced by a minimal contenteditable rich-body surface.
- Imported formatting survives ordinary text edits.
- A compact B / I / U toolbar (plus native keyboard shortcuts) allows users to preserve or add the most useful email emphasis without introducing a full word processor.
- Task edits persist both the plain-text body and sanitized rich HTML. A formatting-only change is treated as a real content-version change and must be reviewed like other edits.

## NetEase compose

- Initial task dispatch already supported `bodyHtml`; imported and edited rich bodies now reach that path.
- The executor sanitizes HTML again immediately before writing into the NetEase editor iframe, preserving only portable email formatting and safe links.

## Deliberate normalization

This is format fidelity, not pixel fidelity. SmartMail preserves semantic emphasis and readable structure; it intentionally does not carry arbitrary font families, font sizes, colors, layout CSS or active HTML into outgoing drafts.
