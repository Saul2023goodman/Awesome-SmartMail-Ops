# SmartMail Ops v3.8.37 — Roster ↔ Imported Mail Reconciliation

## Rollback
- v3.8.36's roster ↔ mailbox Draft reconciliation direction is removed from the lineage.
- v3.8.37 is rebuilt from v3.8.35.
- NetEase Draft / Sent / Inbox data remains mailbox-history evidence only. It is not matched to the reference roster.

## Correct matching target
The reference roster now reconciles only with locally imported Initial email Tasks.

Matching priority:
1. exact recipient email;
2. exact/normalized contact name + institution;
3. contact name + recipient domain;
4. unique contact name as a review candidate;
5. mailbox-local-part/name evidence as a weak candidate.

The imported email recognizer also exposes salutation evidence (for example `Dear Professor Bree Hadley`) to roster matching, improving Word/email-body imports that do not contain a clean recipient field.

## Deterministic enrichment
- Exact email match can supplement missing institution metadata.
- A missing recipient email is auto-filled only when the imported email has a high-confidence **name + institution** match to exactly one roster record.
- Unique-name-only matching never silently changes the imported email; it is shown as a candidate for review.
- If an imported recipient email conflicts with a high-confidence roster identity, the task is explicitly flagged for review.

## Multiple imports
- Uploading additional roster files now appends and merges them instead of replacing the previous roster.
- Roster entries receive stable identity keys after merging, preventing `r1/r2/...` collisions across separately imported roster files.
- Duplicate roster fragments are merged by exact email, or by name + institution only when that does not collapse two different explicit email identities.
- Restored local workspaces normalize old roster fragments before task matching.
- Adding more imported emails automatically reruns roster reconciliation against the existing roster; the roster does not need to be uploaded again.

## Processing order
Roster enrichment now runs before current-batch duplicate and mailbox-history checks, so a deterministically supplemented recipient can participate in downstream duplicate detection.

## UI feedback
The import audit now distinguishes:
- `邮件↔名单` matched count;
- high-confidence emails supplemented from the roster;
- roster contacts not yet represented by imported mail;
- ambiguous mappings;
- recipient-email conflicts.

## Validation
- All JavaScript files pass `node --check`.
- `manifest.json` validates as JSON.
- Smoke checks cover exact-email, name+institution, salutation-derived name matching, and conflicting imported recipient email detection.
