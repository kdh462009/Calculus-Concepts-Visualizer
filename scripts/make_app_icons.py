#!/usr/bin/env python3
"""Build circular UI logo plus macOS .icns and Windows .ico from Calc-Viz-Logo.png."""

from __future__ import annotations

import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "Calc-Viz-Logo.png"
UI_LOGO = ROOT / "src" / "ui" / "core" / "logo.png"
BRANDING = ROOT / "branding"
ICNS = BRANDING / "app-icon.icns"
ICO = BRANDING / "app-icon.ico"

ICONSET_SIZES = [
    ("icon_16x16.png", 16),
    ("icon_16x16@2x.png", 32),
    ("icon_32x32.png", 32),
    ("icon_32x32@2x.png", 64),
    ("icon_128x128.png", 128),
    ("icon_128x128@2x.png", 256),
    ("icon_256x256.png", 256),
    ("icon_256x256@2x.png", 512),
    ("icon_512x512.png", 512),
    ("icon_512x512@2x.png", 1024),
]
ICO_SIZES = (16, 24, 32, 48, 64, 128, 256)


def circle_crop(im: Image.Image, size: int) -> Image.Image:
    im = im.convert("RGBA")
    w, h = im.size
    side = min(w, h)
    left = (w - side) // 2
    top = (h - side) // 2
    square = im.crop((left, top, left + side, top + side)).resize(
        (size, size), Image.Resampling.LANCZOS
    )
    scale = 4
    big = size * scale
    mask = Image.new("L", (big, big), 0)
    ImageDraw.Draw(mask).ellipse((1, 1, big - 2, big - 2), fill=255)
    mask = mask.resize((size, size), Image.Resampling.LANCZOS)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(square, (0, 0))
    out.putalpha(mask)
    return out


def main() -> None:
    if not SOURCE.is_file():
        raise SystemExit(f"error: missing logo at {SOURCE}")
    source = Image.open(SOURCE)
    BRANDING.mkdir(parents=True, exist_ok=True)
    UI_LOGO.parent.mkdir(parents=True, exist_ok=True)

    ui = circle_crop(source, 512)
    ui.save(UI_LOGO, format="PNG")

    master = circle_crop(source, 1024)
    ico_images = [master.resize((s, s), Image.Resampling.LANCZOS) for s in ICO_SIZES]
    ico_images[-1].save(
        ICO,
        format="ICO",
        sizes=[(s, s) for s in ICO_SIZES],
        append_images=ico_images[:-1],
    )

    if sys.platform == "darwin" and shutil.which("iconutil"):
        with tempfile.TemporaryDirectory() as tmp:
            iconset = Path(tmp) / "AppIcon.iconset"
            iconset.mkdir()
            for name, size in ICONSET_SIZES:
                master.resize((size, size), Image.Resampling.LANCZOS).save(
                    iconset / name, format="PNG"
                )
            subprocess.run(
                ["iconutil", "-c", "icns", str(iconset), "-o", str(ICNS)],
                check=True,
            )
    else:
        print("note: iconutil not available; skipped .icns (macOS only)", file=sys.stderr)

    print(f"UI logo: {UI_LOGO}")
    print(f"Windows ico: {ICO}")
    if ICNS.is_file():
        print(f"macOS icns: {ICNS}")


if __name__ == "__main__":
    main()
