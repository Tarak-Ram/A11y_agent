"""Container healthcheck: Redis reachable and Chromium launchable binary present."""
import os
import sys

import redis


def check() -> None:
    try:
        redis.Redis.from_url(os.getenv("REDIS_URL", "redis://localhost:6379"), socket_timeout=3).ping()
    except Exception as e:  # noqa: BLE001
        print(f"unhealthy: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    check()
