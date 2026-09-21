# 3.8.89 — Native Reply-All-with-Attachments Follow-up repair

## Root cause

Follow-up `reply` previously opened the Sent message and searched the rendered page for an exact `回复` action. NetEase Sent (`fid=3`) replaces the ordinary Reply toolbar entry with `再次编辑发送`, while Reply All remains available. The DOM text path therefore could fail before Compose was ever created.

## Reverse-engineered native contract

NetEase `ReadView.getReplyConf()` exposes `回复全部(带附件)` as:

```js
reader.assistant.fullReply({ withAttachments: true })
```

`MailReaderAssistant.reply()` converts this to a reply body with `toAll=true` and `withAttachments=true`. `ComposeManager.entry()` derives the Compose type `reply_all_ach`; Compose initialization changes the data action to `replyallattach`, enables `supportTNEF`, and calls NetEase `replyMessage()`. This is the provider-native path for preserving reply/thread context and carrying the original attachment context.

## Changes

- `reply` Follow-up no longer locates/clicks a DOM `回复` button.
- Added MAIN-world `NMDA_OPEN_REPLY_ALL_WITH_ATTACHMENTS` bridge.
- The bridge waits for the exact read module for the parent Sent message and invokes `reader.assistant.fullReply({withAttachments:true})`.
- Compose identity now records `fromEntry` and `fromEntryDetail` for runtime provenance.
- Executor waits for NetEase `replyMessage()` to populate the expected recipients before editing, preventing a race between native reply hydration and Follow-up body insertion.
- Reply mode no longer mutates recipients after native Reply-All creation; failure to hydrate stops safely instead of degrading to a new message.
- Executor reports whether the resulting Compose is confirmed as `reply / reply_all_ach` and reads the native attachment model for diagnostics.
- Follow-up reply UI now says `Reply All · 回复全部（带附件）`.
- Forward and New Message behavior are unchanged.

## Safety

- The action is tied to the exact parent provider message id.
- No synthetic thread headers or copied attachment blobs are fabricated by SmartMail.
- Existing Compose save/schedule evidence, interruption handling, and exact-compose cleanup remain authoritative.
