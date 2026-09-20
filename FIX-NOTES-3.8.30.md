# SmartMail Ops v3.8.30 — Unified Icon System

## What changed
- Unified the plugin icon language across launcher, header brand, top navigation, import actions, classify dropzones, source inventory, search fields, attachment import, review warnings, plan applied toast, and key dialog status markers.
- Removed mixed character/emoji-style markers such as `N`, `✉`, `名`, `附`, `⇧`, `⌕`, `◎`, and replaced them with one consistent outline SVG icon set.
- Kept the Dock execution glyph system introduced in v3.8.29; the main workspace now visually matches that same refined product language.

## Implementation notes
- Added a shared icon registry inside `app.js` and a DOM decorator that normalizes icons after initial render and after dynamic UI updates.
- Added shared SVG sizing / stroke rules in `app.css` so icons stay consistent across compact and expanded layouts.
- Dynamic sections such as source inventory and classification views are covered by a MutationObserver, so newly rendered content receives the same icon system automatically.

## Result
The plugin no longer feels like a mix of text markers and custom graphics. It now has one coherent, product-level icon language throughout the workspace.
