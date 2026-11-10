from __future__ import annotations

import re

from .models import Finding

WEIGHTS = {"critical": 20, "serious": 10, "moderate": 4, "minor": 1}
FAILURE_PENALTY = 20
REPEAT_FACTOR = 0.25  # each extra instance of the same rule adds this fraction of the rule's weight...
RULE_CAP = 2.0  # ...up to this multiple, so one bad template can't zero the score on its own
BEST_PRACTICE_FACTOR = 0.5  # axe best-practice rules (not a WCAG criterion) count half
_WCAG_SC = re.compile(r"^\d\.\d\.\d+$")


def score(findings: list[Finding], success: bool) -> int:
    """100 minus a per-rule penalty (worst severity of the rule x weight, plus capped repeats), minus a failure penalty."""
    by_rule: dict[str, list[Finding]] = {}
    for f in findings:
        by_rule.setdefault(f.axe_rule_id or f.wcag_rule, []).append(f)
    total = 0.0
    for group in by_rule.values():
        weight = max(WEIGHTS[f.severity] for f in group)
        penalty = min(weight * RULE_CAP, weight * (1 + REPEAT_FACTOR * (len(group) - 1)))
        if not any(_WCAG_SC.match(f.wcag_rule) for f in group):
            penalty *= BEST_PRACTICE_FACTOR
        total += penalty
    if not success:
        total += FAILURE_PENALTY
    return max(0, min(100, round(100 - total)))
