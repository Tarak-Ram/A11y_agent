"""Run one persona against one URL: browser + ADK agent + axe confirmation + scoring."""
from __future__ import annotations

import asyncio
import dataclasses
import os
import uuid

from .a11y_tree import AXView
from .browser import BrowserSession
from .config import get_settings
from .models import Emit, Job, PersonaResult
from .personas import get_persona
from .scoring import score
from .storage import get_storage
from .tools import AgentContext, build_tools, collect_axe_findings

APP = "a11yagents"
# Rough Gemini Flash pricing, USD per token, for the cost cap (override via env if prices change).
PRICE_IN = float(os.getenv("GEMINI_PRICE_IN_PER_TOKEN", "0.30e-6"))
PRICE_OUT = float(os.getenv("GEMINI_PRICE_OUT_PER_TOKEN", "2.50e-6"))


def friendly_llm_error(e: Exception) -> str:
    """Short, actionable text for the report instead of a raw exception dump."""
    text = f"{type(e).__name__} {e}"
    if "RESOURCE_EXHAUSTED" in text or "429" in text or "quota" in text.lower():
        return "The AI agent could not run: the Gemini API quota was exceeded (free tier is about 20 requests per model per day). Axe results are still included; retry later or enable billing."
    if "UNAVAILABLE" in text or "DEADLINE_EXCEEDED" in text or " 503" in text or " 504" in text:
        return "The AI agent could not run: Gemini was overloaded or timed out. Axe results are still included; try again shortly or set GEMINI_MODEL to another model."
    if "API key" in text or "PERMISSION_DENIED" in text or "UNAUTHENTICATED" in text or "403" in text or "401" in text:
        return "The AI agent could not run: the Gemini API key was rejected. Check GEMINI_API_KEY."
    if "NOT_FOUND" in text or " 404" in text:
        return "The AI agent could not run: the Gemini model was not found. Check GEMINI_MODEL."
    return f"The AI agent stopped with an unexpected error ({type(e).__name__}). Axe results are still included."


async def _drive_llm(ctx: AgentContext, persona, goal: str, timeout: int, cost_cap: float) -> tuple[str, float]:
    """Run the ADK agent loop. Returns (stopped_reason, cost_usd)."""
    from google.adk.agents import Agent
    from google.adk.runners import Runner
    from google.adk.sessions import InMemorySessionService
    from google.genai import types

    s = get_settings()
    os.environ.setdefault("GOOGLE_API_KEY", s.gemini_api_key)
    def attach_image(callback_context, llm_request):
        # ADK tools return text; feed the latest screenshot to the model as an image on its next turn.
        if ctx.pending_image:
            llm_request.contents.append(
                types.Content(role="user", parts=[types.Part(text="Screenshot from your last screenshot() call:"), types.Part.from_bytes(data=ctx.pending_image, mime_type="image/png")])
            )
            ctx.pending_image = None
        return None

    from google.adk.models.google_llm import Gemini

    # Gemini sheds load with 503/429 at busy times; retry with backoff instead of failing the whole persona run.
    model = Gemini(
        model=s.gemini_model,
        retry_options=types.HttpRetryOptions(attempts=6, initial_delay=2.0, max_delay=30.0, exp_base=2.0, http_status_codes=[429, 500, 503, 504]),
    )
    agent = Agent(
        before_model_callback=attach_image,
        name=f"{persona.type}_persona",
        model=model,
        instruction=persona.system_prompt(goal, ctx.max_steps),
        tools=build_tools(ctx, persona.tools),
    )
    sessions = InMemorySessionService()
    sid = uuid.uuid4().hex
    await sessions.create_session(app_name=APP, user_id="tester", session_id=sid)
    runner = Runner(agent=agent, app_name=APP, session_service=sessions)
    msg = types.Content(role="user", parts=[types.Part(text=f"Begin. Goal: {goal}")])

    cost = 0.0
    reason = "finished"

    async def loop() -> None:
        nonlocal cost, reason
        async for event in runner.run_async(user_id="tester", session_id=sid, new_message=msg):
            u = getattr(event, "usage_metadata", None)
            if u:
                cost += (u.prompt_token_count or 0) * PRICE_IN + (u.candidates_token_count or 0) * PRICE_OUT
            if ctx.done:
                return
            if cost >= cost_cap:
                reason = "cost_cap"
                return
            if ctx.step_limit_hit and ctx.budget_exhausted():
                # Give the model one more turn to call finish; bail if it doesn't.
                ctx.step_limit_hit = False
                reason = "step_limit"

    try:
        await asyncio.wait_for(loop(), timeout=timeout)
    except asyncio.TimeoutError:
        reason = "timeout"
    if not ctx.done and reason == "finished":
        reason = "step_limit" if ctx.budget_exhausted() else "finished"
    return reason, cost


async def run_persona(job: Job, emit: Emit = lambda *_: None, use_llm: bool = True) -> PersonaResult:
    s = get_settings()
    persona = get_persona(job.persona)
    opts = dataclasses.replace(persona.browser)  # never mutate the shared persona definition
    if job.locale and not opts.locale:  # a persona's own locale (e.g. hi-IN) wins over the project's
        opts.locale = job.locale
    storage = get_storage()
    use_llm = use_llm and bool(s.gemini_api_key)
    reason, cost = ("no_llm", 0.0) if not use_llm else ("finished", 0.0)

    async with BrowserSession(opts) as bs:
        emit("status", {"persona": job.persona, "state": "running"})
        await bs.goto(job.url)
        if persona.on_page_ready:
            await persona.on_page_ready(bs.page)
        ctx = AgentContext(
            page=bs.page,
            view=AXView(bs.page),
            max_steps=min(job.max_steps, s.max_steps),
            emit=emit,
            persona=job.persona,
            jitter_px=persona.jitter_px,
            screenshot_hook=persona.screenshot_hook,
            action_delay=persona.action_delay,
            can_see="screenshot" in persona.tools,
        )
        if use_llm:
            try:
                reason, cost = await _drive_llm(ctx, persona, job.goal, s.run_timeout_seconds, s.cost_cap_usd)
            except Exception as e:  # noqa: BLE001  keep going: axe results are still valuable
                reason = "error"
                ctx.summary = friendly_llm_error(e)
        import tempfile

        for n, issue in enumerate(ctx.issues):
            if issue.get("png"):
                with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
                    f.write(issue.pop("png"))
                issue["shot_url"] = storage.put(f.name, f"runs/{job.run_id}/{job.persona_run_id}/issue-{n}.png")
                os.unlink(f.name)
        agent_findings, axe_only = await collect_axe_findings(ctx)
        video = await bs.finish_video()

    video_url = storage.put(video, f"runs/{job.run_id}/{job.persona_run_id}.webm") if video else None
    findings = agent_findings + axe_only
    # Without an LLM we can't judge goal success; treat "no axe criticals" as success.
    success = ctx.success if use_llm else not any(f.severity == "critical" for f in findings)
    result = PersonaResult(
        persona=job.persona,
        success=success,
        score=score(findings, success),
        summary=ctx.summary,
        video_url=video_url,
        findings=findings,
        steps=ctx.steps,
        stopped_reason=reason,
        cost_usd=round(cost, 4),
    )
    emit("done", {"persona": job.persona, "score": result.score, "success": success})
    return result
