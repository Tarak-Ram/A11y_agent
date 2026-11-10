from ..browser import BrowserOptions
from .base import Persona

# Visible names a language switcher is likely to use.
SWITCH_TEXT = {"hi": ["हिन्दी", "हिंदी", "Hindi"], "te": ["తెలుగు", "Telugu"]}


async def switch_language(page, lang: str = "hi") -> bool:
    """Switch the page to Hindi/Telugu if the site offers it: hreflang alternate first, then a visible switcher."""
    href = await page.evaluate(
        """(l) => { const a = [...document.querySelectorAll('link[rel=alternate][hreflang]')]
              .find(x => x.hreflang.toLowerCase().split('-')[0] === l); return a ? a.href : null; }""",
        lang,
    )
    if href:
        await page.goto(href, wait_until="load")
        return True
    for text in SWITCH_TEXT[lang]:
        loc = page.get_by_role("link", name=text).or_(page.get_by_role("button", name=text)).or_(page.get_by_role("option", name=text)).first
        if await loc.count():
            try:
                await loc.click(timeout=3000)
                await page.wait_for_load_state("load", timeout=10_000)
                return True
            except Exception:  # noqa: BLE001
                pass
    return False


async def on_ready(page) -> None:
    for lang in ("hi", "te"):
        if await switch_language(page, lang):
            return


INDIAN_LANGUAGE = Persona(
    type="indian_language",
    description="A user in India on a budget phone (360x740) with a slow 3G connection, who prefers Hindi or Telugu.",
    instruction="""
The browser is set to hi-IN and the page may already be switched to Hindi or Telugu if the site offers it.
Use the screenshot and tree. Report: no way to choose Hindi/Telugu, or a switcher that doesn't work (3.1.1, 3.1.2);
untranslated or mixed-language strings; wrong or missing lang attributes on translated parts (3.1.2); text that breaks, is clipped or
overlaps in Devanagari/Telugu script (1.4.12, 1.4.10); horizontal scrolling or content cut off at 360px width (1.4.10);
tap targets too small for touch (2.5.8); pages that take very long on slow 3G or show nothing while loading (note it as "moderate").
""",
    tools=["screenshot", "get_accessibility_tree", "click", "type", "press_key", "scroll", "report_issue", "finish"],
    browser=BrowserOptions(viewport=(360, 740), locale="hi-IN", throttle="slow3g", extra_context={"is_mobile": True, "has_touch": True}),
    on_page_ready=on_ready,
)
