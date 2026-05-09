"""Blur account-identifying info in README screenshots.

Regions blurred:
- Sidebar footer (bottom-left): user name + avatar + email — every windowed shot.
- GST Reports header: company GSTIN + state — gst.png only.
- Invoice PDF preview: company GSTIN/email + customer GSTIN/PAN/addresses
  inside the embedded PDF — invoice-pdf.png only.

Originals are backed up to docs/screenshots/.originals/ on first run, so re-running
this script always operates on the unblurred originals. Delete the .originals/
folder if you ever take fresh screenshots and want to re-baseline.
"""

from __future__ import annotations

import os
import shutil
from pathlib import Path

from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
SHOTS = ROOT / "docs" / "screenshots"
ORIG = SHOTS / ".originals"

BLUR_RADIUS = 14  # heavy enough that text is unreadable, light enough to keep layout legible


# Each entry: (filename, [(left, top, right, bottom), ...])
# Coordinates are in source image pixels. App shots are ~1907-1918 px wide.
TARGETS: dict[str, list[tuple[int, int, int, int]]] = {
    # Sidebar footer — user avatar + "Nitesh Gupta" + sign-out icon.
    # Same region across every full-window app screenshot.
    "hero.png":            [(0, 945, 360, 1023)],
    "dashboard.png":       [(0, 945, 360, 1018)],
    "dashboard-light.png": [(0, 945, 360, 1018)],
    "dashboard-dark.png":  [(0, 945, 360, 1023)],
    "sales.png":           [(0, 945, 360, 1012)],
    "purchase.png":        [(0, 945, 360, 1013)],
    "challan.png":         [(0, 945, 360, 1017)],
    "download-menu.png":   [(0, 945, 360, 1017)],
    "invoice-create.png":  [(0, 945, 200, 1008)],  # half-cut by modal overlay

    # GST Reports also exposes the live GSTIN + state in the header bar.
    "gst.png": [
        (0, 945, 360, 1017),                # sidebar footer
        (380, 130, 800, 175),               # "GSTIN: 07ASNPG3910E1Z0 | Delhi"
    ],

    # Invoice PDF preview — the embedded PDF has live company + customer details
    # in two address blocks; blur each block. Coordinates measured against the
    # 1917×1012 source. Sidebar footer also visible behind the modal.
    "invoice-pdf.png": [
        (0, 945, 360, 1012),                # sidebar footer
        (700, 350, 1300, 510),              # company name + address + GSTIN + email block
        (700, 540, 1670, 700),              # BILL TO / SHIP TO blocks (customer addresses)
    ],
}


def ensure_originals() -> None:
    """Copy any not-yet-backed-up screenshot into .originals/ so the script is idempotent."""
    ORIG.mkdir(parents=True, exist_ok=True)
    for name in TARGETS:
        src = SHOTS / name
        dst = ORIG / name
        if not src.exists():
            print(f"[skip] {name}: file missing")
            continue
        if not dst.exists():
            shutil.copy2(src, dst)
            print(f"[backup] {name} -> .originals/{name}")


def blur_regions(image_path: Path, regions: list[tuple[int, int, int, int]]) -> None:
    im = Image.open(image_path).convert("RGBA")
    for box in regions:
        # Clamp to image bounds so a rough coord doesn't crash on smaller shots.
        l = max(0, min(box[0], im.width - 1))
        t = max(0, min(box[1], im.height - 1))
        r = max(l + 1, min(box[2], im.width))
        b = max(t + 1, min(box[3], im.height))
        crop = im.crop((l, t, r, b)).filter(ImageFilter.GaussianBlur(radius=BLUR_RADIUS))
        im.paste(crop, (l, t))
    im.convert("RGB").save(image_path, format="PNG", optimize=True)


def main() -> None:
    ensure_originals()
    for name, regions in TARGETS.items():
        # Always operate on the original so re-running produces the same output.
        original = ORIG / name
        target = SHOTS / name
        if not original.exists():
            print(f"[skip] {name}: no original to blur from")
            continue
        shutil.copy2(original, target)
        blur_regions(target, regions)
        print(f"[blur] {name}: {len(regions)} region(s)")


if __name__ == "__main__":
    main()
