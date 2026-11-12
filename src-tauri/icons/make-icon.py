"""Renders AppIcon.icon/Assets/background.png: the glyph in PATHS as a raised white band on a
dark graphite background, with a drop shadow, side faces, a fold and edge highlights.
The same script is used for Cells, Lookout, Dispatch, Patchy and Backplay; only the glyph
settings below differ.

Usage: python3 make-icon.py [out.png]   (needs Pillow, so not with -I)
"""
import math
import os
import re
import sys

from PIL import Image, ImageChops, ImageDraw, ImageFilter

SIZE = 1024
SS = 3  # supersampling for the glyph mask
GLYPH_WIDTH = 0.50  # Lucide 24 unit box as a fraction of the icon width
STROKE = 3.4  # band width in glyph units (the Lucide original uses 2)
DEPTH = 16  # extrusion depth in px
LIGHT = (-0.55, -0.83)  # light comes from the top left

# squares-unite from lucide-react 1.66.0, in its 24 unit box
PATHS = [
    "M4 16a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v3a1 1 0 0 0 1 1h3a2 2 0 0 1 2 2v10"
    "a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2v-3a1 1 0 0 0-1-1z",
]


def path_points(d, step):
    """Samples an SVG path (M, H, V, L, A, Z, absolute and relative) into points."""
    tokens = re.findall(r"[A-Za-z]|-?(?:\d+\.\d*|\.\d+|\d+)", d)
    pts, i, cmd = [], 0, None
    x = y = sx = sy = 0.0

    def num():
        nonlocal i
        i += 1
        return float(tokens[i - 1])

    def line_to(nx, ny):
        n = max(1, int(math.hypot(nx - x, ny - y) / step))
        pts.extend((x + (nx - x) * k / n, y + (ny - y) * k / n) for k in range(1, n + 1))

    def arc_to(r, fa, fs, nx, ny):
        x1p, y1p = (x - nx) / 2, (y - ny) / 2
        num_ = r ** 4 - r * r * y1p ** 2 - r * r * x1p ** 2
        den = r * r * y1p ** 2 + r * r * x1p ** 2
        coef = math.sqrt(max(0.0, num_ / den)) * (-1 if fa == fs else 1)
        cxp, cyp = coef * y1p, -coef * x1p
        cx, cy = cxp + (x + nx) / 2, cyp + (y + ny) / 2
        t1 = math.atan2((y1p - cyp) / r, (x1p - cxp) / r)
        dt = math.atan2((-y1p - cyp) / r, (-x1p - cxp) / r) - t1
        if fs == 0 and dt > 0:
            dt -= 2 * math.pi
        elif fs == 1 and dt < 0:
            dt += 2 * math.pi
        n = max(1, int(abs(dt) * r / step))
        pts.extend((cx + r * math.cos(t1 + dt * k / n), cy + r * math.sin(t1 + dt * k / n)) for k in range(1, n + 1))

    while i < len(tokens):
        if tokens[i].isalpha():
            cmd = tokens[i]
            i += 1
        rel, c = cmd.islower(), cmd.upper()
        if c == "M":
            nx, ny = num(), num()
            x, y = (x + nx, y + ny) if rel else (nx, ny)
            sx, sy = x, y
            pts.append((x, y))
            cmd = "l" if rel else "L"
        elif c == "L":
            nx, ny = num(), num()
            nx, ny = (x + nx, y + ny) if rel else (nx, ny)
            line_to(nx, ny)
            x, y = nx, ny
        elif c == "H":
            nx = num()
            nx = x + nx if rel else nx
            line_to(nx, y)
            x = nx
        elif c == "V":
            ny = num()
            ny = y + ny if rel else ny
            line_to(x, ny)
            y = ny
        elif c == "A":
            rx, _ry, _rot, fa, fs, nx, ny = (num() for _ in range(7))
            nx, ny = (x + nx, y + ny) if rel else (nx, ny)
            arc_to(rx, int(fa), int(fs), nx, ny)
            x, y = nx, ny
        elif c == "C":
            v = [num() for _ in range(6)]
            if rel:
                v = [v[k] + (x if k % 2 == 0 else y) for k in range(6)]
            x1, y1, x2, y2, nx, ny = v
            n = max(1, int((math.hypot(x1 - x, y1 - y) + math.hypot(x2 - x1, y2 - y1) + math.hypot(nx - x2, ny - y2)) / step))
            for k in range(1, n + 1):
                t = k / n
                a, b, c3, d3 = (1 - t) ** 3, 3 * (1 - t) ** 2 * t, 3 * (1 - t) * t * t, t ** 3
                pts.append((a * x + b * x1 + c3 * x2 + d3 * nx, a * y + b * y1 + c3 * y2 + d3 * ny))
            x, y = nx, ny
        elif c == "Z":
            line_to(sx, sy)
            x, y = sx, sy
    return pts


def glyph_mask():
    big = SIZE * SS
    unit = GLYPH_WIDTH * big / 24
    mask = Image.new("L", (big, big), 0)
    draw = ImageDraw.Draw(mask)
    r = STROKE / 2 * unit
    off = big / 2 - 12 * unit
    # Each path is sampled on its own, since a leading relative moveto starts from 0,0.
    for px, py in (pt for d in PATHS for pt in path_points(d, 0.3 / unit)):
        cx, cy = off + px * unit, off + py * unit
        draw.ellipse((cx - r, cy - r, cx + r, cy + r), fill=255)
    return mask.resize((SIZE, SIZE), Image.LANCZOS)


def gradient(c0, c1, angle_deg=90, size=SIZE):
    """Linear gradient from c0 to c1; angle 90 runs top to bottom, 45 top left to bottom right."""
    g = Image.linear_gradient("L").rotate(90 - angle_deg, resample=Image.BICUBIC, expand=True)
    w, h = g.size
    g = g.crop(((w - 256) // 2, (h - 256) // 2, (w + 256) // 2, (h + 256) // 2)).resize((size, size), Image.BICUBIC)
    return Image.composite(Image.new("RGB", (size, size), c1), Image.new("RGB", (size, size), c0), g)


def shift(mask, dx, dy):
    return ImageChops.offset(mask, int(round(dx)), int(round(dy)))


def with_alpha(color, mask, opacity=1.0):
    layer = Image.new("RGBA", mask.size, color)
    layer.putalpha(mask.point(lambda v: round(v * opacity)))
    return layer


def rounded(inset, radius, width=None):
    m = Image.new("L", (SIZE * SS, SIZE * SS), 0)
    box = (inset * SS, inset * SS, (SIZE - inset) * SS - 1, (SIZE - inset) * SS - 1)
    ImageDraw.Draw(m).rounded_rectangle(box, radius * SS, fill=None if width else 255,
                                        outline=255 if width else None, width=(width or 0) * SS)
    return m.resize((SIZE, SIZE), Image.LANCZOS)


def main(out):
    # Background: graphite, lighter at the top, with a soft glow behind the glyph.
    img = gradient((0x33, 0x34, 0x37), (0x16, 0x17, 0x19)).convert("RGBA")
    glow = Image.new("L", (SIZE, SIZE), 0)
    ImageDraw.Draw(glow).ellipse((150, 40, 874, 640), fill=60)
    img.alpha_composite(with_alpha((255, 255, 255), glow.filter(ImageFilter.GaussianBlur(160)), 0.35))

    # Rim: a thin light edge, bright at the top and fading out toward the bottom.
    radius = SIZE * 0.2237
    rim = rounded(3, radius - 3, width=3).filter(ImageFilter.GaussianBlur(1.2))
    fade = gradient((255, 255, 255), (40, 40, 40)).convert("L")
    img.alpha_composite(with_alpha((255, 255, 255), ImageChops.multiply(rim, fade), 0.35))
    inner = rounded(0, radius, width=26).filter(ImageFilter.GaussianBlur(14))
    img.alpha_composite(with_alpha((0, 0, 0), ImageChops.multiply(inner, gradient((0,) * 3, (255,) * 3).convert("L")), 0.35))

    mask = glyph_mask()
    lx, ly = LIGHT
    dx, dy = -lx * DEPTH * 0.5, -ly * DEPTH  # extrusion goes away from the light

    # Drop shadow: a wide soft one and a tight contact one.
    img.alpha_composite(with_alpha((0, 0, 0), shift(mask, dx * 2, dy * 3.2).filter(ImageFilter.GaussianBlur(34)), 0.70))
    img.alpha_composite(with_alpha((0, 0, 0), shift(mask, dx * 1.2, dy * 1.4).filter(ImageFilter.GaussianBlur(8)), 0.55))

    # Side faces: the mask stacked toward the shadow side, shaded from mid grey to darker.
    side = Image.new("L", (SIZE, SIZE), 0)
    for k in range(1, DEPTH + 1):
        side = ImageChops.lighter(side, shift(mask, dx * k / DEPTH, dy * k / DEPTH))
    side_color = gradient((0xB8, 0xBA, 0xBE), (0x7C, 0x7F, 0x85), 60).convert("RGBA")
    side_color.putalpha(side)
    img.alpha_composite(side_color)

    # Top face: near white, slightly cooler toward the bottom right.
    top = gradient((0xFF, 0xFF, 0xFF), (0xDD, 0xDF, 0xE3), 50).convert("RGBA")
    top.putalpha(mask)
    img.alpha_composite(top)

    # Fold: the band bends along the diagonal through the two inner corners, so the
    # lower right cell faces away from the light and reads as a second panel.
    fold = Image.new("L", (SIZE * 2, SIZE * 2), 0)
    ImageDraw.Draw(fold).rectangle((0, SIZE, SIZE * 2, SIZE * 2), fill=255)
    fold = fold.rotate(45, resample=Image.BICUBIC).crop((SIZE // 2, SIZE // 2, SIZE * 3 // 2, SIZE * 3 // 2))
    fold = fold.filter(ImageFilter.GaussianBlur(10))
    shade = gradient((0xC9, 0xCC, 0xD1), (0xEC, 0xED, 0xEF), 50).convert("RGBA")
    shade.putalpha(ImageChops.multiply(fold, mask))
    img.alpha_composite(shade)
    crease = ImageChops.subtract(fold, shift(fold, 6, 6)).point(lambda v: min(255, v * 3)).filter(ImageFilter.GaussianBlur(2))
    img.alpha_composite(with_alpha((255, 255, 255), ImageChops.multiply(crease, mask), 0.8))

    # Bevel: light catches the edges facing the light, the far edges darken.
    edge_lit = ImageChops.subtract(mask, shift(mask, lx * 5, ly * 5)).filter(ImageFilter.GaussianBlur(2.5))
    edge_dark = ImageChops.subtract(mask, shift(mask, -lx * 6, -ly * 6)).filter(ImageFilter.GaussianBlur(3))
    img.alpha_composite(with_alpha((0x8E, 0x92, 0x99), ImageChops.multiply(edge_dark, mask), 0.45))
    img.alpha_composite(with_alpha((255, 255, 255), ImageChops.multiply(edge_lit, mask), 0.9))

    # Specular sheen across the top part of the glyph.
    sheen = gradient((255, 255, 255), (0, 0, 0), 70).convert("L").point(lambda v: max(0, v - 150) * 2)
    img.alpha_composite(with_alpha((255, 255, 255), ImageChops.multiply(sheen, mask), 0.25))

    img.convert("RGB").save(out)
    print("wrote", out)


main(sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "AppIcon.icon", "Assets", "background.png"))
