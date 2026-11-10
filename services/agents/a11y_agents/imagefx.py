"""Screenshot transforms that simulate how a persona perceives the page."""
from __future__ import annotations

import io

import numpy as np
from PIL import Image, ImageFilter

# Machado et al. (2009) severity=1.0 simulation matrices, applied in linear RGB.
DEUTERANOPIA = np.array([[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]])
PROTANOPIA = np.array([[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]])


def _to_img(data: bytes) -> Image.Image:
    return Image.open(io.BytesIO(data)).convert("RGB")


def _to_png(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _srgb_to_linear(a: np.ndarray) -> np.ndarray:
    return np.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4)


def _linear_to_srgb(a: np.ndarray) -> np.ndarray:
    a = np.clip(a, 0, 1)
    return np.where(a <= 0.0031308, a * 12.92, 1.055 * a ** (1 / 2.4) - 0.055)


def simulate(img: Image.Image, matrix: np.ndarray) -> Image.Image:
    arr = _srgb_to_linear(np.asarray(img, dtype=np.float64) / 255.0)
    out = _linear_to_srgb(arr @ matrix.T)
    return Image.fromarray((out * 255).round().astype(np.uint8))


def low_vision(data: bytes, radius: float = 2.5) -> bytes:
    """Blur (the 200% zoom is applied in the page itself, so pixels here are already zoomed)."""
    return _to_png(_to_img(data).filter(ImageFilter.GaussianBlur(radius)))


def color_blind(data: bytes) -> bytes:
    """Stack the page as seen with deuteranopia (top) and protanopia (bottom), at half height each."""
    img = _to_img(data)
    w, h = img.size
    half = (w, max(1, h // 2))
    top = simulate(img, DEUTERANOPIA).resize(half)
    bottom = simulate(img, PROTANOPIA).resize(half)
    canvas = Image.new("RGB", (w, half[1] * 2))
    canvas.paste(top, (0, 0))
    canvas.paste(bottom, (0, half[1]))
    return _to_png(canvas)
