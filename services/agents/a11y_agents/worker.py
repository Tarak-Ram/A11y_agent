"""Queue consumer. BullMQ (Redis) locally, Pub/Sub in production, same handler.

    python -m a11y_agents.worker
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import signal
import sys
import time
from urllib.parse import urlparse

import httpx
import redis

from .models import Job
from .runner import run_persona
from .storage import get_storage
from .urlfix import friendly_nav_error, rewrite_localhost

QUEUE_NAME = "persona-jobs"
API_URL = os.getenv("API_URL", "http://localhost:4000")
INTERNAL_TOKEN = os.getenv("INTERNAL_TOKEN", "")
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
CONCURRENCY = int(os.getenv("WORKER_CONCURRENCY", "2"))


class JsonLog(logging.Formatter):
    """Structured logs; `severity` is what Cloud Logging reads."""

    def format(self, r: logging.LogRecord) -> str:
        d = {"severity": r.levelname, "message": r.getMessage(), "logger": r.name, "ts": time.time()}
        d.update(getattr(r, "ctx", {}))
        if r.exc_info:
            d["exc"] = self.formatException(r.exc_info)
        return json.dumps(d)


h = logging.StreamHandler(sys.stdout)
h.setFormatter(JsonLog())
logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"), handlers=[h])
log = logging.getLogger("worker")

_redis = redis.Redis.from_url(REDIS_URL)
_headers = {"x-internal-token": INTERNAL_TOKEN}


def make_emitter(job: Job):
    """Publish live events to the run's Redis channel (the API relays them as SSE)."""
    storage = get_storage()
    channel = f"run:{job.run_id}"
    last_shot = 0.0

    def emit(kind: str, payload: dict) -> None:
        nonlocal last_shot
        try:
            if kind == "screenshot":
                if time.time() - last_shot < 1.0:  # throttle: at most ~1 live frame/sec
                    return
                last_shot = time.time()
                tmp = f"/tmp/{job.persona_run_id}.png"
                with open(tmp, "wb") as f:
                    f.write(payload["png"])
                url = storage.put(tmp, f"runs/{job.run_id}/live/{job.persona}.png")
                payload = {"persona": job.persona, "url": url, "t": int(last_shot)}
            _redis.publish(channel, json.dumps({"type": kind, "persona": job.persona, **{k: v for k, v in payload.items() if k != "persona"}}, default=str))
        except Exception:  # live view is best-effort, never fail a job over it
            log.warning("emit failed", exc_info=True)

    return emit


async def handle(data: dict) -> None:
    job = Job(
        run_id=data["runId"],
        persona_run_id=data["personaRunId"],
        persona=data["persona"],
        url=rewrite_localhost(data["url"], os.getenv("LOCALHOST_REWRITE")),
        goal=data["goal"],
        locale=data.get("locale"),
        max_steps=data.get("maxSteps", 40),
    )
    ctx = {"ctx": {"runId": job.run_id, "personaRunId": job.persona_run_id, "persona": job.persona}}
    log.info("job start", extra=ctx)
    async with httpx.AsyncClient(base_url=API_URL, headers=_headers, timeout=30) as api:
        await api.post(f"/internal/persona-runs/{job.persona_run_id}/started")
        try:
            res = await run_persona(job, make_emitter(job))
            body = {
                "status": "done",
                "success": res.success,
                "score": res.score,
                "video_url": res.video_url,
                "summary": res.summary,
                "stopped_reason": res.stopped_reason,
                "cost_usd": res.cost_usd,
                "findings": [f.model_dump(exclude={"source"}) | {"source": f.source} for f in res.findings],
            }
        except Exception as e:  # noqa: BLE001
            log.error("job failed", exc_info=True, extra=ctx)
            body = {"status": "failed", "summary": friendly_nav_error(job.url, e)[:400], "stopped_reason": "error", "findings": []}
        r = await api.post(f"/internal/persona-runs/{job.persona_run_id}/result", json=body)
        r.raise_for_status()
    log.info("job done", extra={"ctx": {**ctx["ctx"], "status": body["status"]}})


def serve_bullmq() -> None:
    from bullmq import Worker

    async def processor(job, _token):
        await handle(job.data)

    async def main():
        u = urlparse(REDIS_URL)
        worker = Worker(
            QUEUE_NAME,
            processor,
            {"connection": {"host": u.hostname, "port": u.port or 6379, "password": u.password}, "concurrency": CONCURRENCY, "lockDuration": 600_000},
        )
        stop = asyncio.Event()
        loop = asyncio.get_running_loop()
        for sig in (signal.SIGINT, signal.SIGTERM):
            try:
                loop.add_signal_handler(sig, stop.set)
            except NotImplementedError:  # Windows
                pass
        log.info("bullmq worker ready")
        await stop.wait()
        await worker.close()

    asyncio.run(main())


def serve_pubsub() -> None:
    from google.cloud import pubsub_v1

    sub = pubsub_v1.SubscriberClient()
    path = sub.subscription_path(os.environ["GCP_PROJECT"], os.getenv("PUBSUB_SUBSCRIPTION", "a11y-jobs-agents"))

    def callback(msg):
        try:
            asyncio.run(handle(json.loads(msg.data)))
            msg.ack()
        except Exception:  # noqa: BLE001 - nack so Pub/Sub redelivers (result endpoint is idempotent)
            log.error("pubsub handler failed", exc_info=True)
            msg.nack()

    flow = pubsub_v1.types.FlowControl(max_messages=CONCURRENCY)
    future = sub.subscribe(path, callback=callback, flow_control=flow)
    log.info("pubsub worker ready")
    with sub:
        future.result()


if __name__ == "__main__":
    (serve_pubsub if os.getenv("QUEUE_DRIVER", "bullmq") == "pubsub" else serve_bullmq)()
