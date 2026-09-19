# v3.8.16 · Review detail layout fix

- Fixed the first-class Review detail editor rendering into legacy implicit grid rows after opening a Follow-up.
- Review now has explicit `data-review-view=board|detail` state owned by JavaScript.
- Detail mode replaces the board entirely: template, filters, queue, empty state and batch controls are hidden while one mail is open.
- The existing per-mail toolbar, audit/correction content, previous/next navigation, Pass actions and close button occupy the full Review workspace.
- Removed obsolete `:has(#nmda-import-editor-overlay...)` layout rules from the embedded-Review era to prevent board/detail row collisions.
- Closing the detail editor or returning to the Review workspace deterministically restores board mode.
