# v3.8.104 · Draft attachment immediate-render root fix

## Symptom

In Utilities → 极速附件, clicking an existing attachment looked like it did nothing. Leaving the utility and entering it again revealed that the attachment had actually been selected. The same failure path could also make choosing a replacement file or starting the motion sequence appear stuck.

## Root cause

`setDraftAttachmentMotion()` called `setText()`, but `setText` only existed as a local helper inside `renderDraftAttachmentTool()`. It was not in scope for the motion renderer.

The existing-attachment click handler performed operations in this order:

1. update `draftAttachmentTool.selectedKey`;
2. update selected draft IDs;
3. call `setDraftAttachmentMotion({hidden:true})`;
4. call `renderDraftAttachmentTool()`.

Step 3 threw `ReferenceError: setText is not defined`, so step 4 never ran. The selection state remained in memory. Re-entering the utility later called `renderDraftAttachmentTool()` from the navigation path, making the old click suddenly appear to have worked.

The replacement-file change handler had the same ordering and the same failure mode. Motion updates at execution start were also exposed to the same exception.

## Fix

- Made `setDraftAttachmentMotion()` self-contained with its own `writeText()` helper.
- Removed every out-of-scope `setText()` call from the motion renderer.
- Kept the existing selection, upload, execution, cancellation, and safe clone/swap logic unchanged.

## Result

- Existing attachment selection updates the active row and replacement plan immediately.
- Replacement file selection updates immediately without leaving/re-entering the page.
- Execution motion can start without being aborted by this UI exception.
- v3.8.103 cancellation and bounded-wait protections remain intact.
