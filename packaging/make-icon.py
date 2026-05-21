#!/usr/bin/env python3
"""Generate MediaGrab app icon (1024px master) → .icns (Mac) + .ico (Windows).

Design: rounded-square with an indigo→violet vertical gradient, a white
download arrow dropping into an open tray (the 📥 motif). Matches the app's
accent color (#6366f1 / #818cf8).

Run: python3 packaging/make-icon.py
Outputs:
  packaging/assets/icon-1024.png
  packaging/assets/AppIcon.icns          (via iconutil)
  packaging/assets/icon.ico              (multi-size)
"""
import os
import math
import subprocess
from PIL import Image, ImageDraw

ASSETS = os.path.join(os.path.dirname(__file__), "assets")
os.makedirs(ASSETS, exist_ok=True)

S = 1024
SUPER = 4  # supersample for smooth edges
W = S * SUPER

img = Image.new("RGBA", (W, W), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

# ── Rounded-square background with vertical indigo→violet gradient ──
def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))

top = (0x4F, 0x46, 0xE5)     # indigo-600
bottom = (0x81, 0x8C, 0xF8)  # indigo-400
radius = int(W * 0.225)      # macOS squircle-ish corner

# Build gradient on a temp image, then mask to rounded rect
grad = Image.new("RGBA", (W, W), (0, 0, 0, 0))
gd = ImageDraw.Draw(grad)
for y in range(W):
    gd.line([(0, y), (W, y)], fill=lerp(top, bottom, y / W) + (255,))

mask = Image.new("L", (W, W), 0)
md = ImageDraw.Draw(mask)
md.rounded_rectangle([0, 0, W - 1, W - 1], radius=radius, fill=255)
img.paste(grad, (0, 0), mask)
d = ImageDraw.Draw(img)

# ── Download arrow + tray (white) ──
cx = W // 2
white = (255, 255, 255, 255)

# Arrow shaft
shaft_w = int(W * 0.105)
shaft_top = int(W * 0.235)
shaft_bot = int(W * 0.50)
d.rounded_rectangle(
    [cx - shaft_w // 2, shaft_top, cx + shaft_w // 2, shaft_bot],
    radius=shaft_w // 2, fill=white,
)

# Arrow head (triangle)
head_half = int(W * 0.165)
head_top = int(W * 0.44)
head_tip = int(W * 0.63)
d.polygon(
    [(cx - head_half, head_top), (cx + head_half, head_top), (cx, head_tip)],
    fill=white,
)

# Tray / inbox (open box catching the download)
tray_left = int(W * 0.25)
tray_right = int(W * 0.75)
tray_top = int(W * 0.66)
tray_bot = int(W * 0.775)
thick = int(W * 0.052)
# Two side walls + bottom forming an open tray
d.line([(tray_left, tray_top), (tray_left, tray_bot)], fill=white, width=thick)
d.line([(tray_right, tray_top), (tray_right, tray_bot)], fill=white, width=thick)
d.line([(tray_left - thick // 2, tray_bot), (tray_right + thick // 2, tray_bot)],
       fill=white, width=thick)

# Downsample to 1024
icon = img.resize((S, S), Image.LANCZOS)
master = os.path.join(ASSETS, "icon-1024.png")
icon.save(master)
print("master:", master)

# ── .ico (Windows) — multi-size ──
ico_path = os.path.join(ASSETS, "icon.ico")
icon.save(ico_path, sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
print("ico:", ico_path)

# ── .icns (Mac) — build .iconset then iconutil ──
iconset = os.path.join(ASSETS, "AppIcon.iconset")
os.makedirs(iconset, exist_ok=True)
specs = [
    (16, "16x16"), (32, "16x16@2x"),
    (32, "32x32"), (64, "32x32@2x"),
    (128, "128x128"), (256, "128x128@2x"),
    (256, "256x256"), (512, "256x256@2x"),
    (512, "512x512"), (1024, "512x512@2x"),
]
for size, name in specs:
    icon.resize((size, size), Image.LANCZOS).save(os.path.join(iconset, f"icon_{name}.png"))

icns_path = os.path.join(ASSETS, "AppIcon.icns")
try:
    subprocess.run(["iconutil", "-c", "icns", iconset, "-o", icns_path], check=True)
    print("icns:", icns_path)
except Exception as e:
    print("iconutil failed (run on macOS):", e)
