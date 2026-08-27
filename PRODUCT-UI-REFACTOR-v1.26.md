# Product UI Refactor v1.26

## Goal

Turn the extension from a technically compact interface into a user-oriented productive UI: readable at desktop density, explicit about current state and next action, and efficient without microtext or redundant cards.

## Design-system references

The redesign was informed by mature open-source design systems and design-system collections on GitHub, especially:

- Awesome Design Systems — design systems as documented principles/best practices, not just component kits.
- Ant Design — Natural / Certain / Meaningful enterprise UI values; state and next actions should be explicit.
- GitHub Primer — focused, calm layout; natural reading order; typography hierarchy should rely on structure and weight rather than excessive color.
- Carbon Design System — productive density for interaction-heavy product pages rather than expressive/content-heavy sizing.
- Fluent UI — cards should represent a single topic; compact arrangements can reduce screen use when information belongs together.

## Cross-screen problems found in v1.25

1. “Less scrolling” had been implemented partly by shrinking helper text into the 7–10px range. This reduced physical height but increased cognitive density.
2. Batch flow repeated the same information in page copy, stage headers, cards and the right-side rail.
3. The import area remained visually dominant after import, even though its job was mostly finished.
4. Review forced users toward parsing evidence for deterministic issues that could be fixed beside the field itself.
5. Single-draft actions were split into too many right-column cards.
6. Contacts used two top cards for one mailbox-control topic, while stretched filter controls displaced the actual list.
7. Flow numbering was not fully aligned with the four-step rail.

## Changes by screen

### Batch — empty state

- Removed duplicate preparation stage chrome from the main canvas.
- Centered one focused “Add material” surface and used negative space deliberately.
- Kept the persistent right-side flow rail as orientation, not as a second content column.
- Clarified the four-step sentence: add material → handle necessary issues → select/schedule → create drafts.

### Batch — imported state

- Import card becomes state-aware: after data exists, source actions compress into a toolbar instead of remaining three large explanatory tiles.
- “Parsing result” becomes “Mail check”; only actionable review information is emphasized.
- Metrics become a compact summary row instead of competing hero cards.
- Roster and recognition diagnostics are visually secondary and progressively disclosed.

### Batch — mail review

- Mail body/editor is the primary visual surface.
- Parsing evidence stays collapsed unless it is actually needed.
- A nearby recipient candidate is surfaced inline below the recipient field; selecting it dispatches the same repair flow as manual editing.
- Focus opening no longer drags the viewport to an arbitrary field position.

### Batch — selection and scheduling

- Selection, automatic scheduling, task table and create action are kept in one working view.
- Stage number is aligned to the four-step navigation: “Select & schedule” is step 3.
- The rail can advance to step 4 when selected items are ready to create.

### Single draft

- Attachment and scheduling are merged into one “Send options” topic card.
- Right column is reduced from three cards to two: options + create action.
- Native file input chrome is replaced by a compact picker summary while preserving the underlying file input.
- Mail content receives most of the horizontal and vertical space.

### Contacts

- Mailbox sync and export are merged into one compact command card.
- Maintenance controls are collapsed behind “only maintain when records are abnormal”.
- Search/filter controls use normal fixed-height product controls rather than stretching with the list card.
- Contact table becomes the first large content surface.

## Visual-system adjustments

- Productive-density neutral palette and semantic CSS variables.
- Increased readable body/control sizes while reducing redundant container height.
- 36px primary control height; clearer 13px card titles and 11px labels.
- Stronger focus-visible outlines for keyboard users.
- Clearer selected/active states without turning every card into a colored surface.
- Responsive behavior retained; a dedicated 1366×768 capture is part of the screenshot suite.

## Measured scroll pressure

Using the same Chromium harness and the same viewport for v1.25 and v1.26:

- Batch, 1600×1100: internal page overflow reduced from 61 px to 39 px.
- Batch, 1366×768: internal page overflow reduced from 393 px to 371 px while increasing readable control/text sizes.
- Contacts, 1366×768: internal page overflow reduced from 74 px to 0 px.
- Single draft: total card count reduced from 4 to 3; the right-side action stack itself went from 3 cards to 2.
- Contacts: total card count reduced from 3 to 2.

The batch screen intentionally retains some vertical overflow on a 768 px-tall viewport rather than reintroducing microtext; the main improvement is that the import/checking work is visible sooner and secondary evidence is progressively disclosed.

## Validation

- Chromium VM screenshots captured for empty batch, imported batch, review, selection/scheduling, 1366×768 imported batch, single draft, and contacts.
- All screenshot runs completed without page-level JavaScript errors.
- Top-level JavaScript syntax checks passed.
- 13/13 existing regression test files passed after the UI refactor.
- Production host permission remains limited to `https://mail.163.com/*`; the VM preview harness remains development-only.

## Screenshot directories

- Baseline v1.25: `vm/screenshots-before/`
- Refactored v1.26: `vm/screenshots/`
- Before/after composites: `vm/comparisons/`
