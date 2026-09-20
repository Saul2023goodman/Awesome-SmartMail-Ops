# SmartMail Ops v3.8.35 — Top-aligned Review + Cumulative Local Workspace

## 1. Review cards no longer start from the bottom

The Review grid now explicitly anchors its content to the top-left (`place-content:start`, `grid-auto-flow:row`) and disables scroll anchoring that could preserve an old bottom position after a batch shrinks.

A fresh Review render also resets the queue scroll position to the top unless the user is intentionally preserving scroll or opening a specific Preview item.

Result: a one-card or small batch begins immediately below the Review toolbar. Unused space stays below the cards.

## 2. Multiple imports are additive again

Selecting another file/folder, dropping another source, pasting another block, or importing another parsed source no longer destroys the current working set.

Default behavior is now:

- first import -> create workspace
- later import -> append to workspace
- same parsed record set -> deduplicated instead of appended twice
- existing task edits / Review confirmations are retained
- existing source-role decisions are retained for old sources
- new sources receive their own classification/configuration
- explicit **清空本批次** is the only normal action that resets the workspace

If an incremental import fails, SmartMail reports the failure while retaining the existing workspace.

## 3. Local workspace persistence restored

`chrome.storage.local` is restored for the parsed working set. The following can survive a SmartMail page reload:

- parsed imported mail/source data
- cumulative source structure
- source collection configuration
- task edits and Review decisions
- Review selection state
- reference-roster state
- handoff state and reusable scheduling workspace state

The Import header shows **本地保存 · 可继续追加** when a workspace exists.

### Attachment boundary

Local attachment **bytes are not silently persisted**. This preserves browser file-security boundaries. After a reload, parsed mail and Review state can be restored, but local attachments must be selected again before execution when required.

Mailbox observations and active execution runtime remain session-fresh and are automatically re-synced from NetEase instead of being treated as durable truth.
