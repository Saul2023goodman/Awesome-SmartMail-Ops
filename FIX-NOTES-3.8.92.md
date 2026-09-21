# v3.8.92 — Utilities Workspace / Fast Attachments First-Class Tool

## Information architecture

- Replaced the top-level **Mail Monitoring** navigation item with a top-level **Utilities / 实用功能** workspace.
- Utilities opens to a tool hub instead of immediately entering one workflow.
- **Mail Monitoring** and **Fast Attachments** are peer utilities in the same first-level page.
- Added two reserved **待开发功能** slots so future standalone tools can be added without expanding the primary navigation.
- Legacy `#monitor` deep links still route to `#utilities/monitor` behavior.

## Fast Attachments utility

Fast Attachments is no longer only a Dispatch execution checkbox. It has a dedicated workspace with:

- current task count;
- current attachment asset count;
- assets eligible for reuse;
- estimated repeated uploads avoided;
- persistent Fast Attachment reuse switch;
- drag/drop or file selection;
- **replace all current batch attachments**;
- **append as shared attachments**;
- **replace one selected attachment while preserving its scope**;
- current attachment-plan list with all / smart / selected scope controls;
- route to the existing precise per-message attachment editor.

Replacing the whole plan or a selected asset enables Fast Attachment reuse automatically. A targeted replacement inherits the previous asset's policy and selected task targets.

## Dispatch responsibility cleanup

- Removed the editable Fast Attachments checkbox from the Dispatch handoff bar.
- Dispatch now shows a compact Fast Attachment status / shortcut only.
- Clicking it routes to `Utilities → Fast Attachments`.
- Dispatch remains responsible for execution timing and launch; Utilities owns attachment tooling and mailbox monitoring.

## Safety / semantics

- Fast Attachments still does **not** claim that a local plan change has already modified a real 163 draft.
- Real mailbox changes happen only during the execution path.
- Existing server-side `internal attachment` reuse and per-attachment fallback behavior from v3.8.91 are unchanged.
- Reply / Forward attachment preservation behavior is unchanged.
