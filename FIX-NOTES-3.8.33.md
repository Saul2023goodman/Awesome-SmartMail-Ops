# SmartMail Ops v3.8.33 — Review Card Collision Fix

## Fixed
- Fixed the review-board cards visually overlapping / clipping into the next row.
- Removed the final hard `128px` row/card constraint that could be smaller than the rendered status + content + issue chips + Preview control.
- Review cards now use `status header + flexible body` grid rows with a 142px minimum height.
- Preview remains inside its own card instead of being pressed against or clipped by the lower border.
- Issue chips stay on one compact line and are clipped/ellipsized instead of increasing the card beyond the row.
- Disabled any hover translation for these dense cards so adjacent rows never visually collide.

## Unchanged
- v3.8.32 automatic mailbox sync / automatic handoff behavior is retained.
- Five-column wide-screen review density is retained.
