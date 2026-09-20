# v3.8.58 — Batch Format Governance

## Why

Template-derived mail batches can preserve wording while drifting in rich-text formatting during document conversion, placeholder substitution, manual edits, or HTML/plain-text transitions. A common failure is that the same title or term is italic in most drafts but plain in a few. Formatting QA therefore belongs between batch derivation and execution, not as a one-off per-message edit.

## Product model

- **Template/source formatting is the intended convention.**
- **Each derived draft is the actual outbound artifact.**
- **Batch format governance is a deterministic repair layer.** It changes only inline formatting of exact text matches; it never rewrites wording.
- Rules operate on all current, non-excluded Initial drafts. Follow-up content is not bulk-rewritten here because effective replies and follow-up communication have a separate lifecycle.
- Existing per-mail review state is preserved when an operator explicitly applies a previewed format rule. The workspace handoff is invalidated so downstream execution uses the new exact body version.

## New workflow

`邮件审阅 → 批量格式 → 输入固定字段 / 选择格式 → 全批次预览 → 应用 → 继续审阅 / 排期`

The panel reports:

- number of drafts containing the phrase;
- total matching occurrences;
- occurrences already compliant;
- drafts/occurrences that need repair;
- structurally unsafe cross-paragraph matches that are skipped;
- per-draft context before applying.

Supported deterministic format assertions:

- italic;
- bold;
- underline;
- strike-through;
- combinations of the above.

Matching is exact text by default and case-sensitive by default. The operator can disable case sensitivity. Multi-line rules are rejected; format governance is intentionally for inline fields/phrases rather than structural body rewriting.

## Drift detection

The panel also scans existing rich formatting for repeated fixed expressions. When the same phrase is formatted in some drafts but appears unformatted in others, it surfaces a **suspected formatting drift** shortcut. Clicking the suggestion fills the exact phrase and format, then runs the normal exact preview. No suggestion is auto-applied.

This is deterministic and local: no AI/NLP or semantic rewriting is involved.

## HTML safety and fidelity

- Plain-text drafts are promoted to sanitized rich HTML only when an actual formatting repair is applied.
- Existing inline formatting is preserved.
- Already compliant matches are idempotent and are not wrapped again.
- A fixed phrase can span inline elements inside one paragraph; the repair wraps the exact range while preserving nested formatting.
- Matches that cross block/paragraph boundaries are skipped instead of risking malformed HTML.
- The final HTML passes through the existing outbound sanitizer and continues through `bodyHtml` to NetEase compose.

## Persistence

Applied rules are stored in the current workspace as lightweight history (up to 30). Recent rules can be clicked to re-check after additional source material is appended. Rules are not silently re-applied to new drafts; the operator sees a fresh preview before every mutation.

## Verification

- All extension JavaScript passes `node --check`.
- Browser-level deterministic tests cover:
  - plain phrase → italic;
  - already-italic idempotence;
  - partially formatted phrase repair;
  - multiple occurrences in one text node;
  - phrase spanning inline elements;
  - cross-paragraph safety skip;
  - multiple simultaneous formats;
  - case-insensitive matching.
