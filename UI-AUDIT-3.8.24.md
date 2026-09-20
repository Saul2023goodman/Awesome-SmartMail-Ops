# SmartMail Ops UI Audit — v3.8.24

## Audit principle
The operator should read state and act; the interface should not continuously explain its own workflow. Permanent copy is kept only when it changes a decision or prevents an unsafe action.

## Findings addressed
1. **Review template consumed primary canvas space.** It is now a header utility (`模板 vN`) and only expands on demand.
2. **Status was repeated inside every Review card.** Success cards now show one status header; redundant “recipient/subject/body recognized” text was removed.
3. **Follow-up identity was duplicated.** Cards now use the recipient identity as the primary title and keep the Follow-up sequence as a compact badge.
4. **Typography drifted across historical CSS layers.** The visible operational scale is normalized around 10 / 11 / 12 / 14 px; legacy microcopy is raised where it is still visible.
5. **Color drifted into multiple unrelated blues/purples/greens.** Neutral surfaces and borders are unified; blue is interaction, green is success, amber is attention, red is error. Category/semantic markers use quieter derived tones.
6. **Page headers contained tutorial prose.** Repeated instructional subtitles were removed from Review, Dispatch, Monitoring, correction mode, attachments, and handoff areas where the controls already communicate the action.
7. **Preview copy competed with content.** Preview retains semantic markers and location status, but removes scrolling/tutorial sentences and redundant success footer text.

## Preserved intentionally
- Warnings that block unsafe execution or explain an exceptional failure.
- Dedupe decisions and mailbox-read prerequisites.
- Semantic markers inside full mail content.
- Runtime-only architecture and tool preference persistence rules.
