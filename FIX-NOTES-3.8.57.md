# SmartMail Ops 3.8.57 — Italic / Quotation Attention Semantics

## Writing-semantics model

Italic and quotation marks overlap in review purpose but are not interchangeable authoring syntax.

- Italic expresses author-selected emphasis, titles, terminology, or conceptual focus.
- Quotation marks delimit quoted wording, named phrases, exact expressions, and sometimes titles/terms.
- Both therefore enter one review-time attention layer, while the original authored representation remains unchanged.

## Changes

- Added deterministic inline quotation detection for curly English quotes, Chinese corner quotes, guillemets, and straight double quotes.
- Review Preview highlights quoted spans with the same attention strength as italics.
- Quotation punctuation is preserved verbatim; it is never converted into italics or other rich text.
- Existing italic formatting continues through DOCX/HTML import, rich preview, editing, and NetEase compose.
- Preview legend now separates **重点表达** (italic / quotation / quote block) from **其他格式** (bold / underline / links / etc.).
- Opening, closing, and subject review surfaces also receive the quotation attention marker.
- Quote punctuation alone does not force a plain-text message into HTML mode.
- Structural blockquotes remain supported and are surfaced as quote-block attention.

## Scope

The attention marker is review-only UI metadata. It is not saved into `bodyHtml` and therefore cannot leak highlighting into the outgoing email.
