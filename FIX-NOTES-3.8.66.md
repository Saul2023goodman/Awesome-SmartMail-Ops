# SmartMail Ops v3.8.66 — Instant Batch Standards Feedback

## Why
The v3.8.60–3.8.65 Batch Standards animation coupled data writes to a per-message choreography. It was visually legible but made a deterministic bulk repair artificially slow. Animation should explain a completed change, not throttle the operation.

## New model
- Batch Standards commits every authorized subject/format repair in one synchronous pass.
- Preview then shows a short visual afterimage on affected rendered messages: one soft document sweep, subject/body settle, rail confirmation, and a compact completion chip.
- The currently visible formatted phrase may receive a brief post-commit highlight.
- Scroll position and active mail are preserved.
- No per-message delays, auto-scrolling, progress orb, execution HUD, or done trail remain.

## Dead-code cleanup
Removed the sequential motion planner, animated per-task executor, scrolling helper, run panel state/DOM references, progress HUD markup, run-row state styles, and interaction locks that existed only because execution took seconds.

## Safety
The actual mutation scope is unchanged: blank Initial subjects only and explicitly previewed format rules only. Existing subjects are never overwritten.
