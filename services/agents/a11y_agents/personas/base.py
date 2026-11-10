from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable

from ..browser import BrowserOptions

COMMON_RULES = """
You are an automated accessibility tester role-playing a real user. You are given a GOAL on a website.
Try to complete it exactly as this user would. Whenever you hit a barrier (anything this user could not
perceive, operate, or understand), call report_issue once for it, with the WCAG success criterion and
the element ref. Do not invent problems: only report what you actually experienced through your tools.
If you are blocked and cannot continue, call finish(success=false, ...). If you complete the goal, call
finish(success=true, ...). You have a strict step budget. Never stop without calling finish.
"""


@dataclass
class Persona:
    type: str
    description: str
    instruction: str
    tools: list[str]
    browser: BrowserOptions = field(default_factory=BrowserOptions)
    jitter_px: int = 0
    screenshot_hook: Callable[[bytes], bytes] | None = None
    # Hooks a persona may use to prepare the page (e.g. switch language, zoom).
    on_page_ready: Callable | None = None
    action_delay: float = 0.0  # seconds to pause after each action (slow, careful users)

    def system_prompt(self, goal: str, max_steps: int) -> str:
        return f"{COMMON_RULES}\nPERSONA: {self.description}\n{self.instruction}\n\nSTEP BUDGET: {max_steps}\nGOAL: {goal}"
