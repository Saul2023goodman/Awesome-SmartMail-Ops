# QA Runtime Ready · v1.47.0

This package now includes a Chromium-based automated UI QA harness under `qa/`.

Run:

```bash
python3 qa/ui_audit.py
```

The runner executes the production import stack and stylesheet, imports representative Word/Excel/PDF fixtures, opens the real classification workflow, captures responsive screenshots, and writes structural UI warnings to `qa/reports/`.

Current baseline result: parsing/source-role regression passes and the runtime import successfully routes the three fixtures to Mail / Roster / Attachment. The baseline UI audit also detects the existing classification-modal containment/overflow problem, which is intentionally left unfixed so it can serve as a before-redesign reference.
