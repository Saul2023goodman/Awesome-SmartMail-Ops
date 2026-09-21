# v3.8.85 — Batch processing applies immediately

- Fixed the Review → Preview batch-processing action appearing to freeze after execution.
- Batch changes are now committed to the visible Preview before expensive whole-batch consistency work runs.
- Added a real browser paint boundary so subject/format changes become visible immediately instead of waiting behind synchronous rescans.
- Coalesced post-apply format-drift analysis instead of running it repeatedly in the same click task.
- Removed unrelated Monitoring re-render work from the batch-apply hot path.
- Prevented the consistency pass from rebuilding the Review queue a second time, preserving scroll position and the simultaneous applied-state feedback animation.
- Kept deterministic batch normalization from creating or clearing unrelated manual-review state.
