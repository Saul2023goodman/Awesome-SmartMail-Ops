# UI Audit — v3.8.25

## Principle

SmartMail is a B2B batch operations tool. Permanent screen area must be reserved for decisions, task state, and execution controls—not hidden utilities or explanatory framing.

## Findings

1. Review still encoded the old template slot as a structural grid row after the template became collapsible. This produced a large visual gap and pushed the mail grid downward.
2. Several first-class pages retained presentation-era spacing: oversized page insets, dashboard metrics, rule bars, and planning headers.
3. Optional UI blocks were visually hidden but the surrounding layout model still assumed their permanent presence.

## Changes

- Replaced Review board fixed-row grid with a content-driven flex stack.
- Optional Review drawers collapse to zero footprint when hidden.
- Reduced permanent chrome in Review, Monitoring, Dispatch, and Import.
- Preserved Preview rail, semantic body markers, exception visibility, and action safety cues.
- Kept the existing unified typography and semantic color system.

## Product boundary

This is a UI-only pass. SmartMail remains runtime-only for business data; only tool preferences such as templates/rules persist.
