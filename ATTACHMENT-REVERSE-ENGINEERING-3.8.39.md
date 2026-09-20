# NetEase 163 Multi-Attachment Reverse Engineering

## What the official frontend does
The official Compose frontend has two upload modes. Modern native mode creates a `multiple` file input, turns each selected browser `File` into an internal attachment object, then feeds those objects into the Compose upload queue. Legacy form mode keeps one physical file input per selected attachment and submits the form when saving/sending.

For native files, the internal object carries fields including `type`, `name`, `size`, `state`, `bytesLoaded`, `percent`, `sid`/`fid`, and the source `blob`. The important states are `select`, `hash`, `wait`, `upload`, `success`, `link`, and `error`.

### Critical queue behavior
`fileAutoUpload()` does not start every file simultaneously. It first resolves selected/hash work, then returns immediately if a native upload is already in progress, otherwise starts the first waiting file. Completion calls `fileAutoUpload()` again, which advances the queue. Therefore a two-file selection commonly has one active file and one pending file.

### Critical save behavior
The official save/send sequence checks `fileIsPost()` and `fileIsUpload()`. If an upload is in progress, NetEase does not immediately execute `save`; it registers an `uploadResult` continuation and completes the save only after its own uploader finishes.

## Why the old SmartMail check was insufficient
SmartMail previously scanned the whole Compose DOM for attachment filenames. The NetEase UI renders an attachment row when the file is added to the queue, before its server upload is necessarily complete. A filename is therefore selection evidence, not commit evidence. The broad DOM scan could also be satisfied by filename text elsewhere in the message body.

## Correct transaction boundary
The safe boundary is the official Compose attachment model, not elapsed time and not filename visibility. SmartMail v3.8.39 queries that model in the page's MAIN world using the already-locked Compose identity. A local file is considered committed only when the corresponding model object reaches the official success/link state.

## Additional integrity boundary
The extension transports local file bytes from the SmartMail app tab to the 163 executor in 256 KiB base64 chunks. v3.8.39 verifies each decoded chunk length and the final reconstructed file size so transport truncation is separately detectable from upload-queue races.
