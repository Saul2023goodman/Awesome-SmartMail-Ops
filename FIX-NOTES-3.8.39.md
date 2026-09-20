# SmartMail Ops v3.8.39 — Multi-Attachment Transaction Barrier

## Reported issue
When a task contains two local attachments, some drafts keep both files while others persist only one. The symptom is intermittent and is more visible when the second upload is slower.

## Reverse-engineering finding
NetEase's current native Compose attachment module does not treat “filename rendered in the UI” as upload completion. Files move through an internal state machine (`select` → `hash` → `wait` → `upload` → `success`). Its `fileAutoUpload()` advances the native queue one item at a time: if one native file is already uploading, the next waits. NetEase's own save/send path checks `fileIsUpload()` and defers the action until the upload sequence reports completion.

The previous SmartMail executor only searched the Compose DOM for expected filenames. Both filenames can be visible immediately after selection while the second file is still waiting or uploading. That evidence was therefore too weak to serve as a transaction boundary.

## v3.8.39 fix
1. **One-file-at-a-time registration handshake**
   - SmartMail no longer injects the entire multi-file `FileList` and assumes selection was accepted.
   - Each file is injected separately.
   - After every injection, SmartMail reads the exact NetEase Compose attachment model (locked to the current Compose identity) and requires the file to appear before registering the next file.

2. **Server-facing upload-state barrier**
   - Before schedule/save, every expected local attachment must be represented in the Compose model.
   - Native attachments must reach `success` or `link`; legacy form-upload attachments are allowed to remain in NetEase's own post-save deferred mode.
   - `error` is a hard failure. SmartMail will not save/close a draft that has a known failed or missing attachment.

3. **Progress-based stall detection**
   - The executor watches per-file state, bytes loaded and percentage.
   - It uses an inactivity watchdog rather than a larger blind sleep. Any state/byte progress resets the watchdog.

4. **Runtime transfer integrity**
   - Every 256 KiB runtime chunk must have exactly the requested byte length.
   - Reconstructed `File.size` must equal the source metadata size.
   - If the extension bridge ever truncates an attachment, execution now fails explicitly instead of uploading a silently shortened file.

5. **Execution progress semantics**
   - “附件已加入网易队列” and “附件上传完成” are now separate phases.
   - The progress UI reflects committed attachments, not merely selected filenames.

## Safety behavior
If two attachments were expected but only one reaches a committed NetEase state, the current email becomes a failed task and the executor does not continue to save it as if attachment handling succeeded. This favors an explicit recoverable failure over a silently incomplete draft.
