import asyncio
import io
from pathlib import Path

from PIL import Image

from a11y_agents import imagefx
from a11y_agents.a11y_tree import AXView
from a11y_agents.browser import BrowserSession
from a11y_agents.models import Job
from a11y_agents.personas import REGISTRY, get_persona
from a11y_agents.runner import run_persona
from a11y_agents.tools import AgentContext, build_tools

SAMPLE = (Path(__file__).resolve().parents[3] / "samples" / "broken-shop" / "index.html").as_uri()


def _png(color):
    b = io.BytesIO()
    Image.new("RGB", (200, 100), color).save(b, "PNG")
    return b.getvalue()


def test_all_six_personas_registered_with_valid_tools():
    assert set(REGISTRY) == {"blind", "low_vision", "color_blind", "motor_tremor", "elderly_first_time", "indian_language"}
    assert "screenshot" not in get_persona("blind").tools  # blind never gets pixels
    for p in REGISTRY.values():
        assert {"report_issue", "finish"} <= set(p.tools)


def test_indian_persona_environment():
    b = get_persona("indian_language").browser
    assert b.viewport == (360, 740) and b.throttle == "slow3g" and b.locale == "hi-IN"


def test_colorblind_filters_change_red_and_stack_two_views():
    out = Image.open(io.BytesIO(imagefx.color_blind(_png((220, 30, 30)))))
    assert out.size == (200, 100)
    top, bottom = out.getpixel((10, 10)), out.getpixel((10, 90))
    assert top != (220, 30, 30) and bottom != (220, 30, 30) and top != bottom


def test_low_vision_blur_softens_edges():
    img = Image.new("RGB", (100, 100), "white")
    img.paste((0, 0, 0), (0, 0, 50, 100))
    b = io.BytesIO()
    img.save(b, "PNG")
    out = Image.open(io.BytesIO(imagefx.low_vision(b.getvalue())))
    assert 20 < out.getpixel((50, 50))[0] < 235  # edge pixel is no longer pure black/white


def test_motor_tremor_misses_tiny_target():
    async def go():
        async with BrowserSession(get_persona("motor_tremor").browser) as bs:
            await bs.goto(SAMPLE)
            ctx = AgentContext(page=bs.page, view=AXView(bs.page), max_steps=40, emit=lambda *_: None, persona="motor_tremor", jitter_px=12)
            click = build_tools(ctx, ["click"])[0]
            return [await click("#add-shoe") for _ in range(12)]  # a 16x16px button

    results = asyncio.run(go())
    assert any("MISSED" in r for r in results), results


def test_every_persona_runs_axe_only(tmp_path, monkeypatch):
    monkeypatch.setenv("STORAGE_LOCAL_DIR", str(tmp_path))
    for name in REGISTRY:
        res = asyncio.run(run_persona(Job(run_id="t", persona_run_id=f"p-{name}", persona=name, url=SAMPLE, goal="x"), use_llm=False))
        assert len(res.findings) >= 5, name
        assert res.video_url, name
