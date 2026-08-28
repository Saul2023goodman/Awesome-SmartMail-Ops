# v2.7 QA Runtime Ready

- Version: `2.7.0`
- Main review board: collision-safe fixed card grid.
- Deterministic missing fields: direct correction on open, no extra correction click.
- Missing-field repair keeps the complete read-first audit visible below the repair dock.
- Duplicate groups: one stacked decision card per unresolved group, then side-by-side version comparison.
- Ambiguous parse issues: read-first audit remains the default.
- Real Word + Excel + PDF baseline QA: PASS.
- 1366×611 and 820×700 deterministic-missing scenario: P0=0 / P1=0.
- 1366×611 and 820×700 duplicate-stack scenario: P0=0 / P1=0.
- Run `python3 qa/ui_audit.py` for the repeatable regression suite.
