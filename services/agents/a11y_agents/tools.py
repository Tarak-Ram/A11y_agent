"""Agent tools, bound to one browser session. Built per persona from a tool allow-list."""
from __future__ import annotations

import asyncio
import random
import time
from dataclasses import dataclass, field
from typing import Callable

from playwright.async_api import Page

from .a11y_tree import AXView
from .axe import confirm_issue, run_axe, violations_to_findings
from .models import Emit, Finding, Step

VALID_SEVERITY = {"critical", "serious", "moderate", "minor"}


@dataclass
class AgentContext:
    page: Page
    view: AXView
    max_steps: int
    emit: Emit
    persona: str
    jitter_px: int = 0  # motor_tremor: random click offset
    steps: list[Step] = field(default_factory=list)
    issues: list[dict] = field(default_factory=list)
    done: bool = False
    success: bool = False
    summary: str = ""
    step_limit_hit: bool = False
    screenshot_hook: Callable | None = None  # persona-specific image transform
    action_delay: float = 0.0
    pending_image: bytes | None = None  # attached to the model's next turn by the runner
    can_see: bool = False  # persona has a screenshot tool

    def log(self, tool: str, args: dict, result: str) -> None:
        step = Step(n=len(self.steps) + 1, tool=tool, args=args, result=result[:300], ts=time.time())
        self.steps.append(step)
        self.emit("step", step.model_dump())

    def budget_exhausted(self) -> bool:
        return len([s for s in self.steps if s.tool not in ("report_issue", "finish")]) >= self.max_steps


def _limit_msg(ctx: AgentContext) -> str:
    ctx.step_limit_hit = True
    return f"STEP LIMIT of {ctx.max_steps} reached. Stop acting and call finish(success=false, ...) now."


async def _settle(page: Page) -> None:
    try:
        await page.wait_for_load_state("domcontentloaded", timeout=3000)
    except Exception:
        pass


async def _pause(ctx: "AgentContext") -> None:
    if ctx.action_delay:
        await asyncio.sleep(ctx.action_delay)


async def _focus_summary(ctx: AgentContext) -> str:
    f = await ctx.view.focused()
    if not f:
        return "focus: (nothing focused; document body)"
    return f'focus: <{f["tag"]}> "{f["text"]}" selector={f["selector"]}'


def build_tools(ctx: AgentContext, allow: list[str]) -> list[Callable]:
    """Create the tool functions (ADK reads the signatures + docstrings) for `allow`."""

    async def get_accessibility_tree() -> str:
        """Return the page's accessibility tree: roles, accessible names, states and a `ref` id for each actionable element. Elements marked (NO ACCESSIBLE NAME) are inaccessible to screen-reader users.

        Returns:
            The tree as indented text.
        """
        if ctx.budget_exhausted():
            return _limit_msg(ctx)
        out = await ctx.view.snapshot()
        ctx.log("get_accessibility_tree", {}, f"{out.count(chr(10))} lines")
        return out

    async def screenshot() -> str:
        """Take a screenshot of the current viewport and look at it.

        Returns:
            A short description; the image itself is attached for you to see.
        """
        if ctx.budget_exhausted():
            return _limit_msg(ctx)
        data = await ctx.page.screenshot(type="png")
        if ctx.screenshot_hook:
            data = ctx.screenshot_hook(data)
        ctx.pending_image = data
        ctx.emit("screenshot", {"persona": ctx.persona, "png": data})
        ctx.log("screenshot", {}, f"{len(data)} bytes")
        return "Screenshot captured (see attached image)."

    async def click(ref: str) -> str:
        """Activate (click) an element.

        Args:
            ref: A ref id from the accessibility tree (e.g. "e7") or a CSS selector.
        Returns:
            What happened and where focus is now.
        """
        if ctx.budget_exhausted():
            return _limit_msg(ctx)
        sel = ctx.view.resolve(ref)
        try:
            loc = ctx.page.locator(sel).first
            if ctx.jitter_px:
                box = await loc.bounding_box(timeout=4000)
                if not box:
                    raise RuntimeError("element has no visible box")
                dx, dy = (random.uniform(-ctx.jitter_px, ctx.jitter_px) for _ in range(2))
                x, y = box["x"] + box["width"] / 2 + dx, box["y"] + box["height"] / 2 + dy
                await ctx.page.mouse.click(x, y)
                landed = await ctx.page.evaluate(
                    "([x,y,sel]) => { const e = document.elementFromPoint(x,y); const t = document.querySelector(sel);"
                    " return {tag: e ? e.tagName.toLowerCase() : null, hit: !!(e && t && (t === e || t.contains(e) || e.contains(t)))} }",
                    [x, y, sel],
                )
                verdict = "HIT the target" if landed["hit"] else "MISSED the target (target is %dx%dpx)" % (box["width"], box["height"])
                res = f"clicked at offset ({dx:+.0f},{dy:+.0f})px; landed on <{landed['tag']}>; {verdict}"
            else:
                await loc.click(timeout=4000)
                res = "clicked"
        except Exception as e:  # noqa: BLE001
            res = f"click failed: {str(e).splitlines()[0][:160]}"
        await _settle(ctx.page)
        await _pause(ctx)
        res += f" | url={ctx.page.url} | {await _focus_summary(ctx)}"
        ctx.log("click", {"ref": ref}, res)
        return res

    async def type(text: str, ref: str = "") -> str:  # noqa: A001
        """Type text into the focused field, or into the element `ref` if given.

        Args:
            text: Text to type.
            ref: Optional ref id or CSS selector to focus first.
        Returns:
            Confirmation and the new focus state.
        """
        if ctx.budget_exhausted():
            return _limit_msg(ctx)
        try:
            if ref:
                await ctx.page.locator(ctx.view.resolve(ref)).first.focus(timeout=4000)
            await ctx.page.keyboard.type(text, delay=30)
            res = f"typed {len(text)} chars"
        except Exception as e:  # noqa: BLE001
            res = f"type failed: {str(e).splitlines()[0][:160]}"
        res += f" | {await _focus_summary(ctx)}"
        ctx.log("type", {"text": text, "ref": ref}, res)
        return res

    async def press_key(key: str) -> str:
        """Press a keyboard key, e.g. "Tab", "Shift+Tab", "Enter", "Space", "ArrowDown", "Escape".

        Args:
            key: Playwright key name.
        Returns:
            The element that now has keyboard focus (what a screen reader would announce).
        """
        if ctx.budget_exhausted():
            return _limit_msg(ctx)
        try:
            await ctx.page.keyboard.press(key)
            await _settle(ctx.page)
            await _pause(ctx)
            res = await _focus_summary(ctx)
        except Exception as e:  # noqa: BLE001
            res = f"key failed: {str(e).splitlines()[0][:160]}"
        ctx.log("press_key", {"key": key}, res)
        return f"{res} | url={ctx.page.url}"

    async def scroll(direction: str = "down") -> str:
        """Scroll the page.

        Args:
            direction: "down" or "up".
        Returns:
            Confirmation.
        """
        if ctx.budget_exhausted():
            return _limit_msg(ctx)
        await ctx.page.mouse.wheel(0, 600 if direction == "down" else -600)
        ctx.log("scroll", {"direction": direction}, "ok")
        return f"scrolled {direction}"

    async def report_issue(wcag_rule: str, severity: str, description: str, ref: str = "") -> str:
        """Report an accessibility barrier you hit. Report each distinct barrier once.

        Args:
            wcag_rule: WCAG success criterion number, e.g. "1.1.1", "2.4.7", "4.1.2".
            severity: One of "critical" (blocks the task), "serious", "moderate", "minor".
            description: What went wrong for this user, in plain words.
            ref: Ref id or CSS selector of the element, if known.
        Returns:
            Acknowledgement.
        """
        sev = severity.lower() if severity.lower() in VALID_SEVERITY else "moderate"
        sel = ctx.view.resolve(ref) if ref else ""
        issue = {"wcag_rule": wcag_rule, "severity": sev, "description": description, "selector": sel, "url": ctx.page.url}
        if ctx.can_see:
            try:
                issue["png"] = await ctx.page.screenshot(type="png")  # raw evidence, not the persona-filtered view
            except Exception:  # noqa: BLE001
                pass
        ctx.issues.append(issue)
        ctx.log("report_issue", {"wcag_rule": wcag_rule, "severity": sev, "ref": ref}, description)
        return "Issue recorded. Continue with the task."

    async def finish(success: bool, summary: str) -> str:
        """End the session. Call when the task is done, or when you are blocked and cannot continue.

        Args:
            success: True only if you fully completed the task goal.
            summary: One or two sentences on what happened.
        Returns:
            Acknowledgement.
        """
        ctx.done, ctx.success, ctx.summary = True, bool(success), summary
        ctx.log("finish", {"success": success}, summary)
        return "Session ended."

    registry = {f.__name__: f for f in (get_accessibility_tree, screenshot, click, type, press_key, scroll, report_issue, finish)}
    return [registry[name] for name in allow]


async def collect_axe_findings(ctx: AgentContext) -> tuple[list[Finding], list[Finding]]:
    """Confirm agent-reported issues against axe, and return (agent_findings, axe_only_findings)."""
    violations = await run_axe(ctx.page)
    agent_findings: list[Finding] = []
    claimed_selectors: set[str] = set()
    for i in ctx.issues:
        ok, rule_id = await confirm_issue(ctx.page, i["selector"], i["wcag_rule"], violations)
        agent_findings.append(
            Finding(
                wcag_rule=i["wcag_rule"],
                severity=i["severity"],
                selector=i["selector"],
                description=i["description"],
                confirmed_by_axe=ok,
                axe_rule_id=rule_id,
                source="agent",
                screenshot_url=i.get("shot_url"),
            )
        )
        if ok:
            claimed_selectors.add(i["selector"])
    axe_all = violations_to_findings(violations)
    # drop axe findings the agent already reported (same selector + same rule id)
    seen = {(f.selector, f.axe_rule_id) for f in agent_findings if f.confirmed_by_axe}
    axe_only = [f for f in axe_all if (f.selector, f.axe_rule_id) not in seen]
    return agent_findings, axe_only
