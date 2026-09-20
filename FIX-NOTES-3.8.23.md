# v3.8.23 · Preview sidebar navigation

## What changed

- Restored the missing document-preview navigation rail on the left side of Review Preview.
- Kept the existing card grid as the default Review surface.
- Reused the card visual language in a compact rail: sequence, Initial/Follow-up type, recipient identity, subject and Review state.
- Clicking a rail card smoothly locates the corresponding full mail sheet.
- Scrolling the continuous reader automatically updates and reveals the active rail card.
- Kept semantic key-information highlights in-place inside the full body; no detached opening/closing blocks were reintroduced.
- Added restrained entry and selection motion with reduced-motion support.
- Progressive rendering remains intact for large Review batches; the rail expands with the rendered page window.

## Product boundaries unchanged

- Runtime-only operational state.
- No `chrome.storage` or IndexedDB operational persistence.
- Only reusable tool preferences such as templates/rules may persist.
