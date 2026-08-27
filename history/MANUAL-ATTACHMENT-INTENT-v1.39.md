# v1.39 Manual Attachment Intent

## Business rule

The attachment picker is an explicit user action. A local file selected with **添加并发送文件** or dropped into the attachment drop-zone is treated as an instruction to send that file with every mail in the current batch.

This rule has higher priority than automatic source-role classification or attachment-reference parsing.

## Safety boundary

- Explicitly selected / dropped files: direct-send attachments (`sharedFiles`).
- Attachment directory: matching pool only; files are attached only when a mail requirement resolves to them.
- Embedded package files and automatically routed attachment sources: matching pool only.
- Existing per-mail attachment references still resolve normally and are merged with direct-send attachments.

This avoids the dangerous behavior of sending every file from a selected folder to every recipient while respecting explicit manual attachment intent.
