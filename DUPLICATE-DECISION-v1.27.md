# Duplicate Mail Decision Flow v1.27

## Why this change exists

The previous flow correctly detected duplicate recipients, but its manual step was modeled as **per-mail confirmation**. That did not match the user's actual decision:

> “Among these mails that may target the same person, which versions do I actually want to keep?”

A user could previously confirm every duplicate mail one by one and still carry all duplicates into draft creation. The warning was acknowledged, but the duplicate was not resolved.

## User operation needs

1. **Decide once per duplicate group, not once per mail.**
   Repeating the same confirmation across 2–5 mails wastes clicks and hides the relationship between candidates.

2. **Compare before choosing.**
   A useful duplicate choice needs subject, source file, body length, attachment count, parse confidence, and a short body preview—not parser internals.

3. **Support more than “keep one” versus “keep all.”**
   A group can contain 3+ mails, and 2 of them may be intentionally valid. The retained set therefore needs multi-select semantics.

4. **Offer a recommendation without making an irreversible automatic choice.**
   The UI preselects the most complete candidate, but never deletes other candidates until the user confirms.

5. **Make intentional duplicates explicit.**
   “全部保留” is a deliberate exception. Exact-email groups mean multiple mails to the same address; probable name+school groups use softer language: “不是同一联系人，全部保留”.

6. **Do not allow generic batch confirmation to bypass dedupe.**
   Duplicate groups are excluded from the ordinary “确认所选” path. Only the group decision can resolve them.

7. **Continue automatically after the decision.**
   Retained mails continue to selection/scheduling; unselected mails are stored as excluded and can still be restored through the existing restore action.

## Interaction model

### Exact recipient duplicate

Header: `同一收件人有 N 封邮件`

Each candidate shows:
- checkbox
- subject / task identity
- recommended marker when applicable
- source
- body length
- attachment count when present
- parse confidence when present
- two-line body preview
- `查看内容`

Actions:
- `保留所选（N）` — keep any selected subset and exclude the rest
- `全部保留` — explicitly record the group as intentional duplicate

### Probable duplicate (same normalized name + institution)

Same comparison layout, but the risk language is softer and the exception action becomes:

`不是同一联系人，全部保留`

## Recommendation rule

The default recommendation uses only current task quality signals:
- valid recipient
- subject present
- body completeness
- import confidence
- whether the task was manually repaired
- penalties for errors / unresolved attachment matching

Recommendation is advisory only. It preselects one candidate but never auto-excludes any mail.

## State behavior

- Retained candidates record the stable duplicate group id in `duplicateConfirmedGroups`.
- Unselected candidates get `importExcluded=true`.
- Rebuilding tasks reruns batch dedupe.
- If two or more intentionally retained mails still form the same group, the persisted group confirmation prevents the duplicate warning from reappearing.
- Editing recipient or institution invalidates the duplicate confirmation as before, because the identity basis has changed.

## Safety improvement

Old behavior:

`duplicate warning -> confirm mail A -> confirm mail B -> both can still proceed`

New behavior:

`duplicate group -> compare candidates -> choose retained set -> exclude rest OR explicitly keep all -> continue`

This turns dedupe from an acknowledgement into an actual business decision.

## Verification

- Existing regression suite: passed.
- New `test-duplicate-decision.js`: passed.
- VM Chromium duplicate scenario: rendered without page-level JavaScript errors.
- Automated UI checks verified:
  - retain 2 of 3 -> selection stage contains 2 mails;
  - retain all 3 -> selection stage contains 3 mails and status records intentional duplication.
