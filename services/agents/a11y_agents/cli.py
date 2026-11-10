"""Run a persona locally, no queue/API needed:

    python -m a11y_agents.cli --url http://localhost:8000 --goal "Buy the shoes" --persona blind
    python -m a11y_agents.cli --url ... --no-llm      # axe-only, no Gemini key needed
"""
import argparse
import asyncio
import json
import uuid

from .models import Job
from .runner import run_persona


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--url", required=True)
    p.add_argument("--goal", default="Explore the main page and try the primary action.")
    p.add_argument("--persona", default="blind")
    p.add_argument("--no-llm", action="store_true")
    a = p.parse_args()

    def emit(kind: str, payload: dict) -> None:
        if kind == "step":
            print(f"  step {payload['n']:>2} {payload['tool']:<24} {payload['result'][:90]}")

    job = Job(run_id="local", persona_run_id=uuid.uuid4().hex[:8], persona=a.persona, url=a.url, goal=a.goal)
    result = asyncio.run(run_persona(job, emit, use_llm=not a.no_llm))
    print(json.dumps(result.model_dump(exclude={"steps"}), indent=2))


if __name__ == "__main__":
    main()
