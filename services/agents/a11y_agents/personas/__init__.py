from .base import Persona
from .blind import BLIND
from .color_blind import COLOR_BLIND
from .elderly import ELDERLY
from .indian_language import INDIAN_LANGUAGE
from .low_vision import LOW_VISION
from .motor_tremor import MOTOR_TREMOR

REGISTRY: dict[str, Persona] = {p.type: p for p in (BLIND, LOW_VISION, COLOR_BLIND, MOTOR_TREMOR, ELDERLY, INDIAN_LANGUAGE)}


def get_persona(name: str) -> Persona:
    try:
        return REGISTRY[name]
    except KeyError:
        raise ValueError(f"unknown persona {name!r}; available: {sorted(REGISTRY)}") from None
