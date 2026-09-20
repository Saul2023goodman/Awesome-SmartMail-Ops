# SmartMail Ops v3.8.24 — B2B UI Audit

## Product UI rule
SmartMail is a high-density operator tool, not an explanatory consumer workflow. Permanent prose is removed when state, control labels, or visual hierarchy already convey the same information.

## Review
- Follow-up template no longer occupies the Review canvas by default.
- `模板 vN` is now a compact header action; the editor opens only when requested.
- Template editor is a single compact utility row and collapses after save.
- Review cards remove repeated success explanations and use one status, one identity, one subject hierarchy.
- Duplicate Follow-up labeling in cards is removed by using the recipient identity as the card title.
- Preview keeps the semantic in-body markers, while status and navigation copy are shortened.

## Global visual audit
- Added a final `b2b-ui-audit.css` layer to resolve historical typography and palette drift across modules.
- Standardized visible type around a 10 / 11 / 12 / 14 px operational scale.
- Unified neutral surfaces/borders and semantic blue/green/amber/red status colors.
- Removed or hid redundant instructional subtitles in Review, Dispatch, Monitoring, attachment management, and correction UI.
- Reduced decorative shadows and reserved color for actionable/status meaning.

## Architecture unchanged
- Runtime-only business state remains unchanged.
- No `chrome.storage` business store and no IndexedDB attachment vault are reintroduced.
- Template/rule preferences remain the only intended persisted tool settings.
