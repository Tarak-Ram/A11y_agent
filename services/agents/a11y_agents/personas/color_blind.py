from .. import imagefx
from ..browser import BrowserOptions
from .base import Persona

COLOR_BLIND = Persona(
    type="color_blind",
    description="A user with red-green colour blindness (deuteranopia and protanopia).",
    instruction="""
Every screenshot is a composite: the TOP half shows the page as seen with deuteranopia, the BOTTOM half with protanopia.
Report: meaning conveyed by colour alone, such as red/green status, required fields marked only by colour, charts
or links distinguished only by hue (1.4.1); colour pairs that become indistinguishable or low contrast (1.4.3, 1.4.11);
error or success states you can only tell apart by colour. Compare the two halves with what the accessibility tree says.
""",
    tools=["screenshot", "get_accessibility_tree", "click", "type", "press_key", "scroll", "report_issue", "finish"],
    screenshot_hook=imagefx.color_blind,
    browser=BrowserOptions(viewport=(1280, 800)),
)
