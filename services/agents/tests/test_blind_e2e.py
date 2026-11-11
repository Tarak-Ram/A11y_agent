"""End-to-end: scan samples/broken-shop (axe-only, no Gemini key needed) -> >= 5 findings."""
import asyncio
from pathlib import Path

import pytest

from a11y_agents.a11y_tree import AXView
from a11y_agents.browser import BrowserOptions, BrowserSession
from a11y_agents.models import Job
from a11y_agents.runner import run_persona
from a11y_agents.scoring import score
from a11y_agents.models import Finding

SAMPLE = (Path(__file__).resolve().parents[3] / "samples" / "broken-shop" / "index.html").as_uri()


def test_blind_scan_finds_at_least_5(tmp_path, monkeypatch):
    monkeypatch.setenv("STORAGE_LOCAL_DIR", str(tmp_path))
    job = Job(run_id="t", persona_run_id="pr1", persona="blind", url=SAMPLE, goal="Buy the shoes")
    res = asyncio.run(run_persona(job, use_llm=False))
    assert len(res.findings) >= 5, [f.axe_rule_id for f in res.findings]
    assert all(f.confirmed_by_axe for f in res.findings)
    assert {"image-alt", "select-name", "button-name", "link-name"} <= {f.axe_rule_id for f in res.findings}
    assert res.score < 70
    assert res.video_url and (tmp_path / res.video_url.removeprefix("/files/")).exists()


def test_tree_flags_unnamed_controls():
    async def go():
        async with BrowserSession(BrowserOptions()) as bs:
            await bs.goto(SAMPLE)
            return await AXView(bs.page).snapshot()

    tree = asyncio.run(go())
    assert "NO ACCESSIBLE NAME" in tree
    assert "ref=e" in tree


def test_score_penalises_failure_and_severity():
    f = [Finding(wcag_rule="1.1.1", severity="critical", description="x")]
    assert score([], True) == 100
    assert score(f, True) == 80
    assert score(f, False) == 60


def test_score_caps_repeats_and_discounts_best_practice():
    def f(sev, rule="r", sc="1.1.1"):
        return Finding(wcag_rule=sc, axe_rule_id=rule, severity=sev, description="x")

    many = [f("critical") for _ in range(30)]
    assert score(many, True) == 60  # 30 repeats of one rule cost at most 2x its weight (40)
    assert score([f("critical", "a"), f("critical", "b")], True) == 60  # distinct rules add up
    bp = [f("moderate", "region", sc="region")]
    assert score(bp, True) == 98  # best-practice-only: 4 * 0.5
    assert 0 < score([f("critical", "image-alt")] * 3 + [f("critical", "select-name"), f("critical", "button-name"), f("serious", "color-contrast")] * 2, True) < 40


def test_axe_confirmation_is_not_fooled_by_page_level_rules():
    """Regression from the first real Gemini run: 'landmark-one-main' (on <html>) must not 'confirm' element-level claims."""
    from a11y_agents.axe import confirm_issue, run_axe

    async def go():
        async with BrowserSession(BrowserOptions()) as bs:
            await bs.goto(SAMPLE)
            v = await run_axe(bs.page)
            return {
                "real": await confirm_issue(bs.page, "#add-shoe", "4.1.2", v),  # empty button: axe button-name
                "div_button": await confirm_issue(bs.page, "#checkout > div", "2.1.1", v),  # axe does not flag this
                "bogus_sc": await confirm_issue(bs.page, "#add-shoe", "1.4.3", v),  # axe flags it, but for another criterion
                "no_selector": await confirm_issue(bs.page, "", "4.1.2", v),
            }

    r = asyncio.run(go())
    assert r["real"] == (True, "button-name")
    assert r["div_button"][0] is False
    assert r["bogus_sc"][0] is False
    assert r["no_selector"] == (False, None)
