# SmartMail Ops v3.8.38 — Imported-mail identity recognition fix

## Root cause found from the supplied real samples
The uploaded roster (`-张一凡择导.xlsx`) contains full supervisor identities, but the Word outreach files often contain no recipient email and only a surname salutation such as `Dear Prof. Bemmann`. v3.8.37 tried to reconcile the roster mainly from recipient/name evidence inside the mail itself, so these files could remain unmatched.

Two source-specific problems were also found:

1. The Word filename is actually strong identity evidence (`Jan H. Bemmann.docx`, `Yujie Zhu.docx`, etc.), but it was not used by the matcher.
2. Two real filenames use escaped Unicode (`#U00c1gnes Birtalan.docx`, `Agata Bareja-Starzy#U0144ska.docx`), and the old normalizer did not decode them.
3. `outreach.zip` also contains matching `*.paras.json` parser sidecars. Because JSON is a supported import format, they were being considered as independent ZIP sources even though they are only diagnostics for the corresponding Word file.

## Fix
- Added `#Uxxxx` and `_xHHHH_` Unicode filename decoding.
- Added accent-insensitive identity normalization.
- Added source filename identity matching as a high-confidence roster signal.
- Added unique surname-salutation fallback (`Dear Prof. Bemmann` -> `Jan H. Bemmann`) as a lower-confidence review signal.
- Exact one-file-per-contact filename matches may now automatically supplement the roster email and school, just like deterministic `name + school` evidence.
- ZIP import now ignores `*.paras.json` only when a same-basename Word file exists, so legitimate standalone JSON imports remain supported.
- Added `文件名识别` to roster reconciliation metrics for traceability.
- Draft/已发送/收件箱 data remains mailbox-history data only; it does **not** participate in roster-to-imported-mail identity matching.

## Validation against the supplied files
Using the exact uploaded roster and the 12 Word outreach identities in `outreach.zip`:

- Roster rows parsed: **14**
- Imported Word contacts tested: **12**
- Correct roster matches: **12 / 12**
- Ambiguous matches: **0**
- Off-roster matches: **0**
- Unicode-escaped filenames correctly restored: **2 / 2**
- Remaining roster contacts not present in the supplied outreach ZIP: **2**

The 12 matched contacts all resolve to the expected roster email and school.
