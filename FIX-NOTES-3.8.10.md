# v3.8.10 · First-class Review UI adaptation

- Removed the oversized Review completion slab. Completion guidance now lives in the Review header: `N/N 已 Pass · 可以进入选择与排期` plus the existing primary dispatch action.
- Forced the first-class Review workspace to a single-column page skeleton so legacy embedded-Import grid rules cannot split the completion state and mail board into separate columns.
- The mail board now owns the remaining canvas and uses a responsive full-width grid (5 columns on wide screens, then 3/2/1 as width decreases).
- Increased review-card typography and hit areas while preserving bounded queue scrolling.
- Review detail/editor behavior and business state transitions are unchanged.
