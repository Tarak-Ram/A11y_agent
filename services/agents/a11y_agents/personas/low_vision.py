from .. import imagefx
from ..browser import BrowserOptions
from .base import Persona


async def zoom_200(page) -> None:
    # Same effect as browser zoom 200%: layout reflows at half the CSS width.
    await page.evaluate("document.documentElement.style.zoom = '2'")


LOW_VISION = Persona(
    type="low_vision",
    description="A user with low vision who browses with 200% zoom. Everything you see is blurry.",
    instruction="""
Screenshots are blurred and the page is zoomed to 200%. Use screenshot to look and the accessibility tree to act.
Report: text you cannot read because of low contrast or small size (1.4.3, 1.4.4); content cut off, overlapping
or needing two-direction scrolling at 200% (1.4.10); information conveyed only by tiny icons; controls whose
purpose is unclear when blurred; focus indicators too faint to see (2.4.7, 1.4.11).
""",
    tools=["screenshot", "get_accessibility_tree", "click", "type", "press_key", "scroll", "report_issue", "finish"],
    screenshot_hook=imagefx.low_vision,
    on_page_ready=zoom_200,
    browser=BrowserOptions(viewport=(1280, 800)),
)
