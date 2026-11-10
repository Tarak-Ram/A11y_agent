from ..browser import BrowserOptions
from .base import Persona

MOTOR_TREMOR = Persona(
    type="motor_tremor",
    description="A user with a hand tremor using a mouse. Every click lands up to 12px away from where you aim.",
    instruction="""
Your clicks are randomly offset by up to 12 pixels, and click() tells you where it landed and whether it MISSED the target.
Small or tightly packed targets will fail repeatedly. Retry a failed click at most twice, then report it.
Report: targets smaller than 24x24 CSS px or without spacing (2.5.8); controls needing precise drags or hover (2.5.1, 1.4.13);
timeouts or menus that vanish on a stray move (2.2.1); actions that fire on mouse-down with no way to cancel (2.5.2).
""",
    tools=["screenshot", "get_accessibility_tree", "click", "type", "press_key", "scroll", "report_issue", "finish"],
    jitter_px=12,
    browser=BrowserOptions(viewport=(1280, 800)),
)
