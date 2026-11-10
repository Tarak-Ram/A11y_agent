from __future__ import annotations

from typing import Callable, Literal

from pydantic import BaseModel, Field

Severity = Literal["critical", "serious", "moderate", "minor"]


class Job(BaseModel):
    run_id: str
    persona_run_id: str
    persona: str
    url: str
    goal: str
    locale: str | None = None
    max_steps: int = 40


class Finding(BaseModel):
    wcag_rule: str  # e.g. "1.1.1" or axe id like "image-alt"
    severity: Severity
    selector: str = ""
    description: str
    screenshot_url: str | None = None
    confirmed_by_axe: bool = False
    source: Literal["agent", "axe"] = "agent"
    axe_rule_id: str | None = None
    html: str | None = None


class Step(BaseModel):
    n: int
    tool: str
    args: dict = Field(default_factory=dict)
    result: str = ""
    ts: float = 0.0


class PersonaResult(BaseModel):
    persona: str
    success: bool
    score: int
    summary: str = ""
    video_url: str | None = None
    findings: list[Finding] = Field(default_factory=list)
    steps: list[Step] = Field(default_factory=list)
    stopped_reason: str = "finished"  # finished | step_limit | timeout | cost_cap | error | no_llm
    cost_usd: float = 0.0


# Live-event callback: (event_type, payload)
Emit = Callable[[str, dict], None]
