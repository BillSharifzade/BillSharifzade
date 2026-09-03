#!/usr/bin/env python3
"""Render wordmark tiles (256x256, skillicons dark style) for tools that have no logo.

Glyphs are converted to <path> data with fontTools so the tiles render identically
everywhere, regardless of which fonts the viewer has installed.

    python3 -m venv .venv && .venv/bin/pip install fonttools
    .venv/bin/python scripts/wordmark-tile.py

Fonts: Noto Sans Bold / Noto Sans Mono Bold (SIL OFL 1.1), looked up via fontconfig.
"""
import subprocess, sys, pathlib
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.boundsPen import BoundsPen

OUT = pathlib.Path(__file__).resolve().parent.parent / "icons" / "wordmarks"
BG, FG, ACCENT = "#242938", "#FFFFFF", "#818CF8"
TILE, MAX_W = 256, 176

# name -> (text, font family, style, font size in px, letter tracking in font units)
# One size per family so the tiles read as a set; MAX_W only kicks in as a safety net.
TILES = {
    "axum": ("axum", "Noto Sans",      "Bold", 66, -10),
    "sqlx": ("SQLx", "Noto Sans",      "Bold", 66, -10),
    "pgx":  ("pgx",  "Noto Sans",      "Bold", 66, -10),
    "asm":  ("ASM",  "Noto Sans Mono", "Bold", 78,   0),
}

def font_file(family, style):
    out = subprocess.check_output(["fc-match", "-f", "%{file}", f"{family}:style={style}"], text=True)
    if not out or family.split()[0].lower() not in out.lower():
        sys.exit(f"font not found: {family} {style} -> {out!r}")
    return out

def word(font_path, text, tracking):
    font = TTFont(font_path)
    gs, cmap, upem = font.getGlyphSet(), font.getBestCmap(), font["head"].unitsPerEm
    kern = {}
    # GPOS pair kerning would need shaping; Noto's short words look fine without it.
    x, cmds, bounds = 0, [], BoundsPen(gs)
    for ch in text:
        g = gs[cmap[ord(ch)]]
        pen = SVGPathPen(gs, ntos=lambda v: f"{v:.1f}")
        g.draw(TransformPen(pen, (1, 0, 0, -1, x, 0)))   # flip y: font units -> SVG (y down)
        g.draw(TransformPen(bounds, (1, 0, 0, -1, x, 0)))
        cmds.append(pen.getCommands())
        x += g.width + tracking
    xmin, ymin, xmax, ymax = bounds.bounds
    return " ".join(cmds), (xmin, ymin, xmax, ymax), upem

def tile(name, text, family, style, size, tracking):
    d, (x0, y0, x1, y1), upem = word(font_file(family, style), text, tracking)
    w, h = x1 - x0, y1 - y0
    s = min(size / upem, MAX_W / w)
    tx = (TILE - w * s) / 2 - x0 * s
    ty = 118 - (y0 + h / 2) * s                  # ink box centred a touch above the middle
    bar_w = 48
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{TILE}" height="{TILE}" fill="none" viewBox="0 0 {TILE} {TILE}">'
        f'<rect width="{TILE}" height="{TILE}" fill="{BG}" rx="60"/>'
        f'<path fill="{FG}" transform="translate({tx:.2f} {ty:.2f}) scale({s:.5f})" d="{d}"/>'
        f'<rect x="{(TILE - bar_w) / 2:.0f}" y="178" width="{bar_w}" height="8" rx="4" fill="{ACCENT}"/>'
        f'</svg>\n'
    )
    (OUT / f"{name}.svg").write_text(svg)
    print(f"{name:6s} font={family} {style:5s} scale={s:.3f} ink={w:.0f}x{h:.0f}u -> {w*s:.0f}x{h*s:.0f}px")

if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    for name, (text, fam, sty, size, tr) in TILES.items():
        tile(name, text, fam, sty, size, tr)
