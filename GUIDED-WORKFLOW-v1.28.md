# v1.28 Guided Workflow — complex-user journey stress test and UX refactor

## 1. Test goal

This iteration treats the plug-in as an end-to-end user workflow instead of a collection of UI cards. The test deliberately combines multiple problem types in one batch, then drives the product from import through review, duplicate resolution, attachments, scheduling and create-ready state at 1366×768.

The core usability questions are:

- Does the user always know what stage they are in?
- Is the next required action unique and obvious?
- Do unrelated functions compete with the current task?
- Can a user scroll or switch issues without losing context or the consequential action?
- When one edit creates a new risk, does the interface immediately reflect the new state?
- Are business blockers separated from optional/technical information?
- Does the final create action remain reachable in long lists?

## 2. Stress fixture

The scenario contains six imported emails and deliberately mixes:

1. a basically usable email with ambiguous trailing content;
2. a second email to the same person, initially missing recipient and requiring an attachment;
3. a mail missing subject;
4. a mail with multiple plausible recipient candidates;
5. a mail with recipient ambiguity and an invalid imported schedule;
6. a clean-core mail requiring two attachments.

After the second recipient is repaired, an exact duplicate group emerges. Resolving that duplicate excludes one version, which also removes the attachment requirement belonging only to that excluded mail. This checks that the workflow recomputes from current business state instead of preserving stale issue counts.

## 3. Baseline defects found

### A. Progress contradiction

The page could say “流程 2/4” while step 1 “添加资料” remained visually active because missing attachments were treated as a step-1 problem. The user therefore had two conflicting answers to “where am I?”.

### B. Attachment task stole attention too early

The attachment panel auto-expanded immediately after import. This pushed recipient, subject, duplicate and body decisions below the fold even though those decisions determine which emails will survive into the batch.

### C. Several competing next actions

The same state could expose “检查邮件”, “添加附件”, “完成上方待办” and other controls. A disabled handoff button was shown before the user could satisfy its preconditions. The interface described implementation modules rather than the user’s current job.

### D. Review page was not a focus mode

Import cards, review cards, diagnostics and downstream sections all remained in one long scroll path. Long bodies changed page height, switching tasks changed the scroll anchor, and the user could scroll outside the active review surface and lose the decision controls.

### E. Technical issue text replaced user instructions

Queue entries surfaced parser phrases such as boundary/closing uncertainty. Those are useful evidence, but they do not answer the user’s question: “What do I need to do to this email?”

### F. Duplicate decisions competed with generic confirmation

A duplicate group could show both the group-level keep decision and generic “确认本封 / 确认并下一封”. This created two different meanings of confirmation in the same viewport.

### G. State could become stale after an edit

Repairing a missing recipient could create a duplicate group, but the UI could remain on the old “补收件人” task until the user navigated away and returned.

### H. Ready and current were conflated

Step 4 could visually look current merely because emails were selectable/creatable even though the user was still scheduling in step 3.

### I. Consequential actions could disappear on scroll

The create card’s intended sticky behavior was neutralized by a global card rule. In long tables the user could lose the “创建草稿” action. Duplicate decisions had the same risk when comparing a long group.

## 4. Product logic after refactor

The batch flow is now:

**添加资料 → 处理待办 → 选择与安排 → 创建草稿**

“处理待办” is intentionally broader than “检查邮件”. It is the single stage for all conditions that block creating drafts, while still sequencing those blockers by business impact.

Priority inside step 2:

1. recipient / identity ambiguity;
2. missing subject or body;
3. duplicate-group decision;
4. roster/contact/school consistency;
5. body boundary or other explicit confirmation;
6. required attachments;
7. other blockers.

The system chooses the next blocker. The user does not need to infer an order from several cards.

## 5. Interaction changes

### Unified todo center

- “邮件检查” becomes “待办中心 / 处理待办”.
- One primary entry point: “继续处理待办”.
- The summary reports current actionable counts instead of exposing several module CTAs.
- The disabled handoff card disappears while blockers exist instead of becoming a dead end.

### Correct progress semantics

- As soon as data exists, step 1 is complete.
- Any blocker keeps step 2 current, including attachments.
- Step 3 becomes current only after blockers clear.
- Step 4 can be “ready” without pretending to be the current step.

### Prioritized, action-oriented review queue

Technical parser messages are translated into actions such as:

- 补收件人
- 核对收件人
- 补主题
- 补正文
- 处理重复
- 核对正文
- 核对联系人
- 确认修改

Parser evidence remains available through secondary disclosure.

### Focus mode for review

While resolving mail todos:

- unrelated import/result/diagnostic/downstream cards leave the scroll path;
- the current review context stays at the top;
- long bodies use an internal scroll rather than expanding the whole page indefinitely;
- the review footer remains sticky where a generic confirmation is appropriate;
- duplicate-group actions remain reachable while comparing candidates;
- the user can no longer scroll into unrelated stages and lose the active task.

### Continuous state transitions

After a field is repaired, the current task is recomputed immediately. If repairing a recipient creates a duplicate group, the same surface changes directly from “补收件人” to “处理重复”. There is no navigate-away/navigate-back requirement.

### Duplicate decision exclusivity

When a duplicate group is unresolved, generic mail-confirm buttons disappear. The only decision surface is the duplicate group: select the versions to keep, or explicitly keep all.

### Attachments happen at the right time

Attachment requirements are still visible in summary counts, but the attachment panel does not auto-expand while higher-priority mail decisions remain. Once mail review reaches zero, the attachment panel becomes the next task automatically.

### Sticky final action

The create card is explicitly sticky and overrides the global static card rule. Scrolling the selection table no longer removes the final “创建 N 封草稿” action from view.

## 6. Full journey validation

Automated user journey at 1366×768:

- Import: 6 emails, 8 actionable todos, only one primary next action.
- Review opens in focus mode: scroll height drops to 834px from the former long multi-card review surface.
- Recipient repair creates duplicate state immediately in place.
- Duplicate group is resolved with one group-level decision; one mail is excluded.
- Mail todos reach 0; remaining blockers recompute to 2 required attachments.
- Adding those attachments automatically enters step 3.
- Step 3 is current; step 4 is shown as ready, not active.
- Five emails receive scheduling.
- At the bottom of the selection table, “创建 5 封草稿” remains visible.
- No page-level JavaScript errors were observed in the full journey.

## 7. General rules learned from this case

These rules should govern future features as well:

1. **One state, one answer to “what next?”** New capabilities should join the todo resolver instead of adding another equal-weight CTA.
2. **The progress rail reflects business completion, not component ownership.** An attachment can be rendered in the import area without making it “step 1”.
3. **Fix identity before investing in downstream work.** Recipient/duplicate decisions precede attachments and scheduling because they can remove entire tasks.
4. **A changed fact invalidates dependent decisions.** Any edit that affects identity, duplication, attachments or scheduling must recompute downstream state immediately.
5. **Keep evidence secondary to action.** Technical detail is inspectable, not the default description of the user’s job.
6. **Focus mode is preferable to stacking more cards.** When a task needs attention, remove unrelated surfaces from the scroll path instead of merely highlighting one card.
7. **Ready is not current.** A later action can be available without stealing the progress indicator from the user’s current stage.
8. **Consequential actions survive scrolling.** Confirm, keep/discard, apply schedule and create actions must remain reachable in long content.
9. **Do not show disabled future handoffs as a pseudo-next-step.** Explain the blocker and reveal the handoff when its preconditions are satisfied.
10. **Counts come from current surviving tasks.** Excluding a duplicate or changing a requirement must immediately update todo and attachment counts.

## 8. Regression coverage

The existing parser, roster, scheduling, source-routing, recipient-ownership, batch-review, duplicate-decision, performance and UI contract suites all pass after the refactor. New guided-workflow assertions cover:

- unified todo semantics;
- prioritized next-action routing;
- review focus mode;
- attachment sequencing;
- ready-vs-current progress state;
- sticky review, duplicate and create actions;
- current-state re-evaluation after edits.

The VM stress test and full journey test are retained under `vm/` for future visual regression work.
