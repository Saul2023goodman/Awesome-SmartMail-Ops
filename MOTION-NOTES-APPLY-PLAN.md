# Apply Plan motion study

Trigger: successful click on “应用排期”.

Motion language:
- Existing visible task cards use FLIP-style spatial reflow from their previous matrix position to the newly planned slot.
- Newly scheduled visible cards enter with a short magnetic settle animation instead of appearing abruptly.
- Round headers settle in sequence to make the new R1/R2/R3 structure readable.
- A restrained horizontal planning sweep and temporary “Plan applied” confirmation tie the transition together.
- The matrix scroll position is preserved.
- Per-card animation is capped to visible cards (max 90) for large batches.
- `prefers-reduced-motion` is respected.

Implementation:
- `app.js`: task motion keys, geometry capture, FLIP/reveal animation, render-after-apply transition.
- `dispatch-ui.css`: sweep, toast and motion styling.
