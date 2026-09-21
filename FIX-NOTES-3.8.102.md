# v3.8.102 · Contact Monitor action-view + reply classification fix

## Root cause fixed

- The card renderer could show the newest historical `ambiguous` observation even when the contact's **current** state was already `replied`. That produced the contradictory “已有回复” + red “需要判断” combination seen in the screenshot.
- A high-confidence automatic reply could also be downgraded to `ambiguous` when one contact had multiple historical outbound messages.
- This was an association ambiguity, not a reply-type ambiguity. Because automatic replies are non-blocking facts, asking the operator to resolve the parent message was unnecessary and produced the confusing red review strip.
- The ambiguity panel is now rendered only when the **current view state** is actually driven by an ambiguous inbound; historical ambiguity no longer leaks into unrelated current states.
- `reconcileInboundReplies()` now keeps automatic replies non-blocking even when several historical outbounds are candidates. Genuine human messages with weak association remain `ambiguous`.

## Reply review UX

- Ambiguous inbound mail is now presented as **“需要你确认一封来信”**, not as an unexplained system warning.
- The review strip contains **“查看这封来信”** and opens the exact 163 inbox message when a provider message id is available; otherwise it opens the inbox.
- Decisions are phrased as user actions: **计为有效回复 / 这是自动回复 / 不属于这次联系**.
- Provider-side `Automatic reply:` / `Auto response:` subject decoration is used internally for deterministic classification but normalized for display. The stored mailbox subject is not rewritten.
- Decision paths now ask **“有有效回复吗？”**; when only an automatic reply exists, they explicitly say **“没有 · 自动回复不计入”**.

## Filter redesign

The old flat status filter was replaced with operational work views:

1. **需要我处理** — due follow-up, replies requiring handling, ambiguous inbound, and other blockers.
   - Secondary filters: 需要跟进 / 处理回复 / 确认来信 / 其他待处理.
2. **等待中** — no action required now.
   - Secondary filters: 等待时间 / 已安排发送.
3. **本轮结束** — follow-up attempt limit reached.
4. **全部** — complete contact set.

A separate **已跟进次数** selector supports 0 / 1 / 2+ filtering without mixing this dimension into contact state. Search continues to work across contact identity, subject and reply evidence.

## Compatibility

- Existing Follow-up generation, review, dispatch, reply disposition and mailbox routing are preserved.
- v3.8.101 utilities scrolling fix is retained.
