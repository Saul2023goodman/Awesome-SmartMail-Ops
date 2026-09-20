# v3.8.67 — Preview Batch Processing deep integration

## Product model

The old Batch Standards lens treated subject repair and format governance as QA tools, while Follow-up body authoring lived in a separate Review toolbar. That split was artificial: all three are deterministic batch rules whose scope can be previewed before one operator authorization.

v3.8.67 replaces the user-facing "Batch Standards" concept with **Batch Processing** in Preview.

### Included deterministic batch work

- **Subject completion** — fills blank Initial subjects only; never overwrites existing subjects.
- **Format normalization** — exact phrase + requested inline formats, with drift detection and match preview.
- **Follow-up body template governance** — maintains the shared body used to derive Follow-up tasks. Salutation and signature remain inherited from each Initial message.

These actions share one plan summary and one apply action. Human judgement such as Review confirmation stays separate and is not silently automated.

## Follow-up template integration

The separate Review-level Follow-up template button/card and its event/state/CSS paths were removed.

The Batch Processing lens now shows the template as a first-class batch rule:

`Inherited salutation + body template + inherited signature`

A template edit is included in the same batch plan as subject/format repairs. The plan explicitly shows the next template version and whether existing pending Follow-up tasks can be synchronized.

### Version-aware pending-task synchronization

New Follow-up tasks are marked `templateManaged: true`.

When a template changes, the operator may synchronize existing Follow-up tasks that are:

- not sent/cancelled/blocked/scheduled; and
- still template-managed.

A manual body edit flips `templateManaged` to `false`, so later template updates never overwrite customized Follow-up copy. Scheduled Follow-ups are also left unchanged and surfaced as locked to the old version.

`Operations.refreshTemplateManagedFollowUps()` performs the deterministic refresh and re-runs automatic review gating on the refreshed version.

## Monitoring integration

The Monitoring page no longer opens a separate template editor. Its template shortcut now routes to:

`Mail Preview -> Batch Processing -> Follow-up body template`

Missing-template warnings point to the same canonical location.

## Dead code removal

Removed runtime/UI paths for:

- `nmda-review-followup-template-*`
- `nmda-review-template-toggle`
- legacy Review subject repair prompt/entry CSS
- old Review-board template layout rows
- old standalone template save handlers

## Validation

- All JavaScript files pass `node --check`.
- Follow-up template refresh was tested for template-managed pending tasks.
- Manual Follow-up body edits were verified to remain protected from later template changes.
- CSS brace balance and archive integrity are checked before packaging.
