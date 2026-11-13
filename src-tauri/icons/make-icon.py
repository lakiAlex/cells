"""Renders AppIcon.icon/Assets/background.png: a white spreadsheet with a header row, grid lines and a
selected cell, in front of a grey sheet, on a dark graphite background, with soft shadows and a light bevel.
The image is a full square; macOS rounds the corners.

Usage: python3 make-icon.py [out.png]   (needs Pillow, so not with -I)
"""
import os
import sys

from PIL import Image, ImageChops, ImageDraw, ImageFilter

SIZE = 1024
SS = 4  # supersampling for the shapes
RADIUS = SIZE * 0.2237  # corner radius of the system mask, used for the rim

GRAPHITE = ((0x26, 0x27, 0x2B), (0x0E, 0x0E, 0x10))
PAPER = ((0xFF, 0xFF, 0xFF), (0xDD, 0xDF, 0xE3))
BACK = ((0x9A, 0x9D, 0xA3), (0x6B, 0x6E, 0x75))
HEADER = ((0xC4, 0xC7, 0xCD), (0x8E, 0x92, 0x99))
LINE = (0x8E, 0x92, 0x99)
SELECTED = (0x2A, 0x2B, 0x2F)
FRONT = (160, 260, 754, 854)  # front sheet box; the back sheet is the same size, up and to the right
BACK_BOX = (270, 170, 864, 764)
COLS, ROWS = 4, 5


def ss_mask(draw_fn):
    m = Image.new("L", (SIZE * SS, SIZE * SS), 0)
    draw_fn(ImageDraw.Draw(m), SS)
    return m.resize((SIZE, SIZE), Image.LANCZOS)


def linear(c0, c1, angle=90):
    """Linear gradient from c0 to c1; angle 90 runs top to bottom."""
    # A rotated square of side 364 still covers its central 256 square at any angle.
    g = Image.linear_gradient("L").resize((364, 364), Image.BICUBIC).rotate(90 - angle, resample=Image.BICUBIC)
    g = g.crop((54, 54, 310, 310)).resize((SIZE, SIZE), Image.BICUBIC)
    return Image.composite(Image.new("RGB", (SIZE, SIZE), c1), Image.new("RGB", (SIZE, SIZE), c0), g)


def layer(color, mask, opacity=1.0):
    l = Image.new("RGBA", (SIZE, SIZE), color)
    l.putalpha(mask.point(lambda v: round(v * opacity)))
    return l


def fill(img, colors, mask, angle=70):
    g = linear(*colors, angle).convert("RGBA")
    g.putalpha(mask)
    img.alpha_composite(g)


def rr(x0, y0, x1, y1, r):
    return ss_mask(lambda d, s: d.rounded_rectangle((x0 * s, y0 * s, x1 * s, y1 * s), r * s, fill=255))


def sheet(img, box, colors, offset, blur):
    """A sheet with a soft shadow and a bevel: lit top edge, darker bottom edge."""
    page = rr(*box, 56)
    img.alpha_composite(layer((0, 0, 0), ImageChops.offset(page, *offset).filter(ImageFilter.GaussianBlur(blur)), 0.6))
    fill(img, colors, page)
    lit = ImageChops.subtract(page, ImageChops.offset(page, 0, 5)).filter(ImageFilter.GaussianBlur(2))
    shade = ImageChops.subtract(page, ImageChops.offset(page, 0, -5)).filter(ImageFilter.GaussianBlur(3))
    img.alpha_composite(layer((255, 255, 255), lit, 0.5))
    img.alpha_composite(layer((0, 0, 0), shade, 0.25))


def main(out):
    img = linear(*GRAPHITE).convert("RGBA")

    sheet(img, BACK_BOX, BACK, (0, 16), 24)
    sheet(img, FRONT, PAPER, (0, 20), 28)

    # Grid on the front sheet: a sunk header row, then the cell lines.
    x0, y0, x1, y1 = FRONT[0] + 60, FRONT[1] + 60, FRONT[2] - 60, FRONT[3] - 60
    cw, ch = (x1 - x0) / COLS, (y1 - y0) / ROWS
    header = rr(x0, y0, x1, y0 + ch, 14)
    fill(img, HEADER, header)
    img.alpha_composite(layer((0, 0, 0), ImageChops.subtract(header, ImageChops.offset(header, 0, -4)).filter(ImageFilter.GaussianBlur(2)), 0.2))
    grid = Image.new("L", (SIZE, SIZE), 0)
    d = ImageDraw.Draw(grid)
    for c in range(1, COLS):
        d.line((x0 + c * cw, y0, x0 + c * cw, y1), fill=255, width=5)
    for r in range(1, ROWS):
        d.line((x0, y0 + r * ch, x1, y0 + r * ch), fill=255, width=5)
    img.alpha_composite(layer(LINE, grid.filter(ImageFilter.GaussianBlur(0.6)), 0.55))

    # Selected cell: second column, third row.
    sx, sy = x0 + cw, y0 + 2 * ch
    sel = ss_mask(lambda d, s: d.rounded_rectangle(((sx - 4) * s, (sy - 4) * s, (sx + cw + 4) * s, (sy + ch + 4) * s), 8 * s, outline=255, width=12 * s))
    img.alpha_composite(layer(SELECTED, sel))

    # Soft highlight at the top and a faint rim along the system mask.
    hl = linear((255, 255, 255), (0, 0, 0)).convert("L").point(lambda v: max(0, v - 170) * 2)
    img.alpha_composite(layer((255, 255, 255), hl, 0.10))
    rim = ss_mask(lambda d, s: d.rounded_rectangle((2 * s, 2 * s, (SIZE - 2) * s, (SIZE - 2) * s), (RADIUS - 2) * s, outline=255, width=3 * s))
    img.alpha_composite(layer((255, 255, 255), ImageChops.multiply(rim, linear((255,) * 3, (30,) * 3).convert("L")), 0.25))

    img.convert("RGB").save(out)
    print("wrote", out)


main(sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "AppIcon.icon", "Assets", "background.png"))
