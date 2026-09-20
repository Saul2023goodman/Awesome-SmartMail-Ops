# v3.8.60 — Sequential Batch Format Rewrite Motion

## Why this belongs in execution, not decoration

Batch format governance is a deterministic mutation across many template-derived drafts. The previous implementation applied every matching draft in one synchronous burst, so the operator could not see which mail was being changed or whether the batch was progressing in the intended order. v3.8.60 makes the execution itself visible without changing the underlying deterministic rule semantics.

## Motion model

Each affected mail now passes through four explicit phases:

1. **Locate** — the Preview page and left rail item become active and the exact fixed phrase is highlighted.
2. **Rewrite** — a narrow sweep crosses the mail while the requested rich-text format is actually written to `bodyHtml`; the Preview body is refreshed immediately so the format visibly lands.
3. **Settle** — the page, rail item, and governance result row receive a restrained completion trace.
4. **Advance** — the next mail becomes active. Previous completed items retain a light progress trail until the run finishes.

The animation duration adapts to batch size. Small batches are deliberately legible; large batches accelerate while still mutating strictly one mail at a time. `prefers-reduced-motion` collapses the animation while preserving sequential execution.

## Reliability / scope

- The visual highlight and sweep exist only in Preview and are never persisted into outgoing email HTML.
- The actual mutation still uses the existing exact-text governance engine and `sanitizeEmailRichHtml`.
- Review confirmation state is preserved exactly as in v3.8.59.
- Edits are persisted during the run, not only after the final animation.
- For batches beyond the initially rendered Preview window, rendering expands in chunks and previously completed progress marks are restored.
- Preview editing, rail navigation, and leaving Preview are blocked during the active rewrite run to prevent UI/state races.
- After a successful run, the original Preview mail, main scroll position, and rail position are restored.
- The execution panel shows current subject, recipient, per-mail position, overall progress, and a before → formatted-after representation of the fixed phrase.

## Visual language

The effect is intentionally restrained: precise target emphasis, a narrow luminous scan, a short format-settle pulse, and a progressive rail trace. It avoids decorative particle effects so the motion communicates work and evidence rather than becoming unrelated spectacle.
