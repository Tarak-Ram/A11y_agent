"""axe-core injection, result normalisation and agent-issue confirmation."""
from __future__ import annotations

import re
from pathlib import Path

from playwright.async_api import Page

from .models import Finding

AXE_PATH = Path(__file__).parent / "vendor" / "axe.min.js"
WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"]

IMPACT_TO_SEVERITY = {"critical": "critical", "serious": "serious", "moderate": "moderate", "minor": "minor"}

# Agent-friendly wcag rule ids -> axe rule ids that evidence them (used when the
# selector alone is ambiguous).
_TAG_RE = re.compile(r"^wcag(\d)(\d)(\d{1,2})$")


def wcag_from_tags(tags: list[str]) -> list[str]:
    out = []
    for t in tags:
        m = _TAG_RE.match(t)
        if m:
            out.append(f"{m.group(1)}.{m.group(2)}.{m.group(3)}")
    return out


async def run_axe(page: Page) -> list[dict]:
    """Run axe on the current page and return raw violations."""
    await page.add_script_tag(path=str(AXE_PATH))
    result = await page.evaluate(
        "tags => axe.run(document, {runOnly: {type: 'tag', values: tags}, resultTypes: ['violations']})",
        WCAG_TAGS,
    )
    return result["violations"]


def _describe(v: dict, node: dict) -> str:
    """'<rule help>: <first specific check message>' (skips axe's generic role-override boilerplate)."""
    msgs = [c.get("message", "") for k in ("any", "all", "none") for c in node.get(k, []) if c.get("message")]
    msgs = [m for m in msgs if "default semantics" not in m]
    return f"{v['help']}: {msgs[0]}" if msgs else v["help"]


def violations_to_findings(violations: list[dict]) -> list[Finding]:
    findings: list[Finding] = []
    for v in violations:
        wcag = wcag_from_tags(v.get("tags", []))
        for node in v["nodes"]:
            findings.append(
                Finding(
                    wcag_rule=wcag[0] if wcag else v["id"],
                    axe_rule_id=v["id"],
                    severity=IMPACT_TO_SEVERITY.get(node.get("impact") or v.get("impact") or "moderate", "moderate"),
                    selector=" ".join(node["target"][-1:]) if node.get("target") else "",
                    description=_describe(v, node),
                    confirmed_by_axe=True,
                    source="axe",
                    html=node.get("html"),
                )
            )
    return findings


async def confirm_issue(page: Page, selector: str, wcag_rule: str, violations: list[dict]) -> tuple[bool, str | None]:
    """Is the element an agent complained about also flagged by axe?

    Match = same element, or axe flagged an ancestor/descendant of it, and (if the agent
    named a WCAG SC) that SC is among the violation's tags.
    Returns (confirmed, axe_rule_id).
    """
    if not selector:
        return False, None
    candidates = []
    for v in violations:
        sc = wcag_from_tags(v.get("tags", []))
        if wcag_rule and re.match(r"^\d\.\d\.\d+$", wcag_rule) and sc and wcag_rule not in sc:
            continue
        for node in v["nodes"]:
            if node.get("target"):
                candidates.append({"id": v["id"], "sel": node["target"][-1]})
    if not candidates:
        return False, None
    hit = await page.evaluate(
        """([sel, cands]) => {
            let el; try { el = document.querySelector(sel); } catch (e) { return null; }
            if (!el) return null;
            for (const c of cands) {
              let t; try { t = document.querySelector(c.sel); } catch (e) { continue; }
              if (t && (t === el || t.contains(el) || el.contains(t))) return c.id;
            }
            return null;
        }""",
        [selector, candidates],
    )
    return (hit is not None), hit
