import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    gemini_api_key: str
    gemini_model: str
    max_steps: int
    run_timeout_seconds: int
    cost_cap_usd: float
    storage_driver: str
    storage_local_dir: str
    gcs_bucket: str
    # Chromium's sandbox must stay on unless the container cannot support it.
    browser_no_sandbox: bool


def get_settings() -> Settings:
    """Read env on every call (so tests and workers can override it)."""
    e = os.getenv
    return Settings(
        gemini_api_key=e("GEMINI_API_KEY", ""),
        gemini_model=e("GEMINI_MODEL", "gemini-2.5-flash"),
        max_steps=int(e("MAX_STEPS", "40")),
        run_timeout_seconds=int(e("RUN_TIMEOUT_SECONDS", "300")),
        cost_cap_usd=float(e("RUN_COST_CAP_USD", "1.00")),
        storage_driver=e("STORAGE_DRIVER", "local"),
        storage_local_dir=e("STORAGE_LOCAL_DIR", "./storage"),
        gcs_bucket=e("GCS_BUCKET", ""),
        browser_no_sandbox=e("BROWSER_NO_SANDBOX", "0") == "1",
    )
