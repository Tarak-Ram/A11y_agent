from __future__ import annotations

import tempfile
from dataclasses import dataclass, field
from pathlib import Path

from playwright.async_api import Browser, BrowserContext, Page, async_playwright

from .config import get_settings


@dataclass
class BrowserOptions:
    viewport: tuple[int, int] = (1280, 800)
    locale: str | None = None
    device_scale_factor: float = 1.0
    throttle: str | None = None  # "slow3g"
    extra_context: dict = field(default_factory=dict)


SLOW_3G = {"offline": False, "latency": 400, "downloadThroughput": 50_000, "uploadThroughput": 50_000}


class BrowserSession:
    """One sandboxed, disposable Chromium per job, with video recording."""

    def __init__(self, opts: BrowserOptions):
        self.opts = opts
        self.video_dir = Path(tempfile.mkdtemp(prefix="a11y-video-"))
        self.page: Page | None = None
        self.context: BrowserContext | None = None
        self._pw = None
        self._browser: Browser | None = None
        self._video_path: Path | None = None

    async def __aenter__(self) -> "BrowserSession":
        s = get_settings()
        self._pw = await async_playwright().start()
        args = ["--no-sandbox"] if s.browser_no_sandbox else []
        self._browser = await self._pw.chromium.launch(args=args)
        w, h = self.opts.viewport
        self.context = await self._browser.new_context(
            viewport={"width": w, "height": h},
            record_video_dir=str(self.video_dir),
            record_video_size={"width": min(w, 1280), "height": min(h, 800)},
            locale=self.opts.locale,
            device_scale_factor=self.opts.device_scale_factor,
            service_workers="block",
            **self.opts.extra_context,
        )
        self.page = await self.context.new_page()
        if self.opts.throttle == "slow3g":
            cdp = await self.context.new_cdp_session(self.page)
            await cdp.send("Network.enable")
            await cdp.send("Network.emulateNetworkConditions", SLOW_3G)
        return self

    async def goto(self, url: str) -> None:
        await self.page.goto(url, wait_until="load", timeout=45_000)

    async def finish_video(self) -> Path | None:
        """Close the context so the video is flushed; returns the .webm path."""
        if self.page and self.page.video:
            video = self.page.video
            await self.context.close()
            self.context = None
            self._video_path = Path(await video.path())
        return self._video_path

    async def __aexit__(self, *exc) -> None:
        try:
            if self.context:
                await self.context.close()
            if self._browser:
                await self._browser.close()
        finally:
            if self._pw:
                await self._pw.stop()
