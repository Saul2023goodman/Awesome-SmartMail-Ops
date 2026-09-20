# SmartMail Ops v3.8.62 — Preview Format Lens & Deliberate Rewrite Motion

## Why this refactor

The v3.8.59/60 format-governance implementation was functionally inside Preview but still behaved like a top-level toolbar workflow: the entry button occupied permanent toolbar width and the expanded editor consumed a full horizontal strip above the email document. That contradicted the intended information hierarchy. Preview's scarce top chrome should stay dedicated to navigation and semantic reading aids; batch-format governance is an occasional contextual action.

The previous sequential animation also compressed its timing according to total batch size (`7200 / total`, clamped to 90–620 ms). On medium/large batches this reduced each email to a rapid flash. The motion technically remained sequential, but visually it became a speed indicator instead of communicating locate → inspect → rewrite → settle.

## New interaction model

- Removed the Batch Format button from the Preview toolbar.
- Added a floating Preview-native **format lens** on the document edge. It is a compact 42 px control, expands only on hover/focus, and shows the drift count as a small badge.
- Opening the lens produces a floating glass sidecar over the Preview surface. It does not add a grid row, push the email downward, or consume permanent vertical space.
- The sidecar keeps all existing governance abilities: fixed phrase, format selection, drift suggestions, per-mail hit preview, recent rules, and deterministic apply.
- During execution the sidecar folds into a compact HUD so the email document remains visually primary.
- Closing the lens restores the unobtrusive edge control.

## New motion choreography

The batch rewrite is still deterministic and sequential, but the animation is now a composed four-stage gesture per mail:

1. **Focus** — the target email is deliberately brought into the viewing center and softly lifted.
2. **Trace** — matching phrase(s) are highlighted and a restrained luminance trace moves through the mail surface.
3. **Ink-set** — the real `bodyHtml` mutation occurs; the corrected phrase receives a brief settling bloom instead of a fast full-page sweep.
4. **Rest** — the rail and page leave a quiet completion mark before the sequence advances.

Cadence is no longer a single batch-wide slot. It follows a motion curve: the opening entries and final entries are slightly slower, while the middle finds a stable rhythm. Large batches therefore remain efficient without turning into strobing flashes. Scrolling is now controlled with a deterministic eased interpolation instead of repeated native smooth-scroll calls.

## Safety / data behavior

- Animation remains Preview-only and never enters outbound HTML.
- Actual format writes still occur one mail at a time and are persisted after each successful mutation.
- Existing Follow-up history reconciliation from v3.8.61 is preserved.
- `prefers-reduced-motion` keeps deterministic sequential execution while removing decorative motion.

## Validation

- Full JavaScript syntax check passed.
- All CSS files have balanced block braces.
- `nmda-review-format-governance` exists exactly once.
- Format entry is no longer inside the Preview toolbar DOM.
- Format lens is located in the Preview document surface and remains Preview-only through CSS state.
