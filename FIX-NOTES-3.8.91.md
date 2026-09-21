# v3.8.91 — Batch Fast Attachment Replace / Reuse

## Goal

Add an optional batch attachment acceleration path alongside Fast Compose. The desired attachment set remains task-authoritative, but repeated local assets no longer need to be uploaded once per message.

## Native NetEase contract used

Reverse engineering confirmed NetEase's attachment center uses `mbox:listAttachments` and attaches an existing mailbox attachment with:

- `type: internal`
- `_mid: <source message id>`
- `_part: <source attachment part id>`
- `name` / `size`

The target Compose receives the copy through `mbox:compose` with `action: continue`. This is the same server-side path used by NetEase's own “从邮箱中添加附件” UI.

## Batch architecture

1. The workbench counts attachment usage across the executable batch by stable `Importer.fileIdentity()`.
2. A new optional **极速附件** switch starts a fresh attachment-reuse session for that batch.
3. A repeated asset is never matched against arbitrary historical mailbox files by filename alone. The first occurrence is uploaded from the actual local `File` through the existing verified NetEase upload path.
4. After NetEase has saved that Compose, SmartMail reads `mbox:listAttachments` and accepts a source only when it belongs to that exact newly saved draft and matches the expected name/size. This yields a trusted `messageId + partId` source.
5. Later messages bind the trusted source via one native `mbox:compose(action=continue)` internal-attachment request, then confirm the attachment exists in the current Compose model.
6. If the source is missing, rejected, stale, or cannot be verified, only that attachment falls back to the normal local upload path. The task does not fail merely because the fast path is unavailable.

## Scheduled-message seeding

A scheduled submission does not preserve the normal draft id on `ComposeInfo`. For a newly uploaded asset that is needed again later in the batch, SmartMail therefore performs one native **draft checkpoint** before the final schedule submission. The checkpoint exists only to obtain a stable mailbox `messageId + partId`; the same Compose then continues to its requested schedule. One-off attachments do not pay this extra step.

## Safety properties

- No reuse from arbitrary same-name historical files.
- No silent success: server-side bind must return through NetEase's native callback and the current Compose attachment model must contain the expected item.
- Reply / Forward remain context-preserving and do not use batch fast replacement.
- Existing upload verification remains the fallback and source of truth.
- Fast Compose and Fast Attachment are independent toggles and can be used together.

## UI / telemetry

Dispatch now exposes **极速附件** next to **极速 Compose**. Execution results record:

- `fastRequested`
- `fastReuseCount`
- `fastFallbackCount`
- `uploadedCount`
- `cachedSources`
- attachment mode (`fast-reuse`, `fast-reuse+native-upload`, or standard modes)
