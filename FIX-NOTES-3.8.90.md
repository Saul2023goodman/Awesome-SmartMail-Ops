# v3.8.90 — Optional Fast Native Compose

## Goal

Add an optional high-speed Compose execution path without replacing the existing stable visible-Compose workflow.

The fast path skips per-field DOM automation and drives NetEase's own Compose internals directly:

- `ComposeForm.setContact()`
- `ComposeForm.setSubject()`
- `ComposeEditor.set()`
- native Schedule model
- `ComposeBase.sendBuild()`
- `ComposeBase.send()`

NetEase still owns final HTML compilation, `getFinal()`, charset, schedule timezone normalization,
sender-name validation, recipient/subject checks, and `mbox:compose` submission.

## UI

Dispatch adds a persistent opt-in toggle:

- `极速 Compose`

Default: off.

Preference key:

- `nmda.compose.fastNative.v1`

The toggle is locked while a batch is executing.

## Eligibility and fallback

Fast Native Compose is currently enabled for ordinary `composeMode=new` tasks.

Reply / Reply-All / Forward continue to use the standard native visible path because preserving
provider thread, quote, and inherited attachment context has priority over speed.

If the current NetEase runtime does not expose the required native methods, the same Compose
instance automatically falls back to the existing DOM path. The task is not failed merely because
Fast Compose is unavailable.

## Native formatting

For HTML source bodies, Fast Compose no longer runs SmartMail's conservative HTML flattener first.
The rich source HTML is passed to NetEase `editor.set()`, and NetEase's own editor filtering plus
`getFinal()/getFinalContent()` generate the final content, including the native
`data-ntes="ntes_mail_body_root"` wrapper when required.

The optional paragraph-spacing normalization remains available before the native editor stage.

## Native schedule

Fast Compose writes the requested `Date` directly into the native Schedule model and submits with
`action="schedule"`. `sendBuild()` then applies NetEase's own `getWithTimeZoneFixed()` conversion.
No year/month/day/hour/minute DOM selects are manipulated.

## Attachments

Local attachments still use the existing NetEase attachment upload model and are required to reach a
committed native state before save/schedule submission. Fast Compose does not infer attachment
success from visible filenames.

Server-side internal attachment rebinding remains a separate future optimization; this release does
not fake or infer `_mid/_part` references.

## Submission and recovery

Fast mode calls `ComposeBase.send()` directly instead of clicking the visible "存草稿" button.

It still shares the normal transaction guard:

- promotion dialogs are absorbed;
- blocking English-optimization promotion causes a controlled re-submit;
- sender-name prompt soft-pauses and resumes the same task;
- closing the name prompt without saving re-arms NetEase's sender-name check;
- unknown business dialogs are not blindly dismissed.

Success is still proven by NetEase UI/business evidence:

- ordinary draft: fresh success tip or draft route;
- scheduled draft: `定时发信设置成功`.

## Performance

The 300 ms inter-task settling delay is reduced to 60 ms while Fast Compose is enabled.
The largest speedup comes from removing recipient/subject/body/options/schedule DOM interaction.

Compose creation and server acknowledgement remain real asynchronous operations and are not treated
as instantaneous merely because the native method call returned.

## Diagnostics

Execution outcome records:

```text
fastCompose.requested
fastCompose.active
fastCompose.engine
fastCompose.detail.compiled
```

The native preflight summary includes recipient counts, subject, HTML mode, priority, receipt flag,
charset, compiled content length, and native scheduleDate.
