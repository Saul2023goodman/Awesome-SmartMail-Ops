# v3.8.55 — Effective reply handoff

## Product boundary
SmartMail is a batch outreach / Follow-up execution tool. It only needs to answer one operational question after an inbound message arrives: **may this conversation continue through automated Follow-up?**

The user-facing reply state is therefore reduced to:

- **未回复** — automated Follow-up may continue according to policy.
- **已回复** — an effective reply has been received; SmartMail stops automation and hands the conversation back to the operator.

SmartMail does not manage the highly customized reply that follows an effective response.

## Auto-reply is a feature, not a peer state
Auto-reply detection remains deterministic evidence used when deciding whether an inbound message counts as an effective reply. Provider flags, subject/sender/body patterns, OOO signals and the <=3 minute heuristic can set `autoReplyFeature`.

An inbound observation carrying this feature is still treated operationally as **未回复**. It does not stop the Follow-up clock. The monitoring row may surface the feature as supporting evidence, but it is no longer presented as the opposite of a “human reply”.

For backward compatibility the runtime observation still uses the existing internal `kind` values. Product logic now exposes explicit helpers for the semantic predicates `isEffectiveReplyObservation()` and `hasAutoReplyFeature()`.

## Effective reply handoff
When an effective reply is detected:

1. The thread state becomes **已回复**.
2. Any pending Follow-up remains blocked / is removed from queued execution as before.
3. SmartMail shows **“有效回复，需要人工回复；SmartMail 不再生成 Follow-up”**.
4. The row exposes only the primary action **“前往邮箱”**.
5. “前往邮箱” focuses the connected 163 mailbox and opens the exact inbound message by provider message id using NetEase's native `read.ReadModule` route.

No in-plugin Reply composer, scripted response, or automatic continuation is introduced.

## Manual correction
- Ambiguous inbound: `计为已回复` / `自动回复 · 忽略` / `与本邮件无关`.
- Auto-reply feature: `计为已回复` is available as a correction if the feature was a false positive.
- User-facing copy no longer uses “有效回复”.

## Regression coverage
- Clear Automatic Reply -> autoReply feature, non-blocking, remains operationally unreplied.
- <=3 minute direct response -> heuristic autoReply feature, non-blocking.
- Ordinary associated response after the heuristic window -> effective reply, Follow-up blocked.
- Effective reply row -> only “前往邮箱” action.
- `NMDA_OPEN_MAIL_MESSAGE` -> focuses 163 and opens the inbound provider message in the native read module.
