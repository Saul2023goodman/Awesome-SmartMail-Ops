# v3.8.3 — Import-time Duplicate Verification

## Architecture change
- Duplicate verification is now owned by Import, not Mail Review.
- Import performs source classification, current-batch duplicate detection, historical-mailbox duplicate evidence, roster cross-check, and duplicate-group decisions before review.
- Mail Review now owns only message content/readiness issues: recipient, subject, body, ambiguous parsing, and explicit content confirmation.

## Flow
`Import → duplicate verification → clean task set → Mail Review → Selection & Scheduling`

## Behavior
- Current-batch duplicate groups must be resolved before Mail Review can open.
- The user can keep the recommended version, select multiple versions, or explicitly keep all.
- Historical Sent/Draft matches remain visible as evidence/warnings and are not silently excluded.
- Editing identity fields during Mail Review can invalidate prior duplicate facts; if a new duplicate group appears, the workflow returns to Import verification.
- The former hidden Review duplicate filter/cards/decision mode have been removed.
