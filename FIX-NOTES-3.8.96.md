# v3.8.96 — Draft attachment native-delete contract fix

## Root cause

v3.8.95 correctly switched attachment mutation from Draft MID to the Compose CID returned by `mbox:restoreDraft`, which removed `FA_ID_NOT_FOUND`. The remaining `FS_UNKNOWN` was caused by conflating two different NetEase native `mbox:compose(action="continue")` contracts.

Reverse-engineered `ComposeAction` shows:

- `syncAttach()` sends `{ id: cid, action: "continue", returnInfo: true, attrs: { attachments } }`.
- `deleteAttach()` sends `{ id: cid, action: "continue", attrs: { attachments: [{id:sid, deleted:true}] } }` and **does not send `returnInfo`**.

v3.8.95 reused `returnInfo:true` for deletion. Current 163 routes the deletion form differently and returns `FS_UNKNOWN` for that mixed contract.

## Fix

- Delete mutation now mirrors native `ComposeAction.deleteAttach()` field-for-field: no `returnInfo`.
- Delete success is no longer expected to return `var.attachments`; native code only checks `response.code`.
- After delete returns success, SmartMail calls `mbox:getComposeInfo({id:cid})` and verifies every deleted SID is absent before save/schedule commit.
- Old attachment SIDs are now resolved **after** the internal-add mutation from the latest current-CID attachment state instead of from the initial restore snapshot.
- The newly attached replacement is explicitly excluded while remapping the old attachment. Matching priority is current ID -> current part -> name/size fallback.
- Any remap or post-delete verification failure cancels the Compose session without committing the draft.

## Preserved behavior

- Replacement attachment is added before old attachment deletion.
- Draft body, recipients, subject, and scheduling preservation checks remain enabled.
- Scheduled drafts still commit using `action:"schedule"`.
- Temporary source draft cleanup still uses native `mbox:cancelComposes({deleteDraft:true})`.
