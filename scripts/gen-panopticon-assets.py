#!/usr/bin/env python3
"""Regenerate trayTemplate.png and icon.png from the panopticon geometry (matches watchtower-mark.svg)."""
from __future__ import annotations

import math
import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"


def downsample_box_rgba(
    src: bytearray, Wa: int, Ha: int, Wb: int, Hb: int
) -> bytearray:
    """Average RGBA over each output pixel’s footprint (cheap supersampling AA)."""
    dst = bytearray(Wb * Hb * 4)
    sx = Wa / Wb
    sy = Ha / Hb
    for yb in range(Hb):
        y0 = int(math.floor(yb * sy))
        y1 = int(math.ceil((yb + 1) * sy))
        y0 = max(0, min(Ha, y0))
        y1 = max(y0 + 1, min(Ha, y1))
        for xb in range(Wb):
            x0 = int(math.floor(xb * sx))
            x1 = int(math.ceil((xb + 1) * sx))
            x0 = max(0, min(Wa, x0))
            x1 = max(x0 + 1, min(Wa, x1))
            sr = sg = sb = sa = 0
            cnt = 0
            for yi in range(y0, y1):
                for xi in range(x0, x1):
                    i = (yi * Wa + xi) * 4
                    sr += src[i]
                    sg += src[i + 1]
                    sb += src[i + 2]
                    sa += src[i + 3]
                    cnt += 1
            j = (yb * Wb + xb) * 4
            dst[j] = sr // cnt
            dst[j + 1] = sg // cnt
            dst[j + 2] = sb // cnt
            dst[j + 3] = sa // cnt
    return dst


def encode_png_rgba(W: int, H: int, buf: bytearray) -> bytes:
    """buf is W*H*4 RGBA row-major."""

    def chunk(t: bytes, d: bytes) -> bytes:
        crc = zlib.crc32(t + d) & 0xFFFFFFFF
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", crc)

    raw = bytearray()
    for y in range(H):
        raw.append(0)
        for x in range(W):
            i = (y * W + x) * 4
            raw.extend(buf[i : i + 4])

    idat = zlib.compress(bytes(raw), 9)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", W, H, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", idat)
        + chunk(b"IEND", b"")
    )


def set_px(buf: bytearray, W: int, H: int, x: float, y: float, rgba: tuple[int, int, int, int]) -> None:
    xi, yi = int(round(x)), int(round(y))
    if 0 <= xi < W and 0 <= yi < H:
        i = (yi * W + xi) * 4
        buf[i : i + 4] = bytes(rgba)


def stamp_disk(
    buf: bytearray,
    W: int,
    H: int,
    x: float,
    y: float,
    rad: float,
    rgba: tuple[int, int, int, int],
) -> None:
    """Filled disk stamp for consistent stroke weight at small sizes."""
    r = max(rad, 0.35)
    xi0 = max(0, int(math.floor(x - r - 1)))
    xi1 = min(W, int(math.ceil(x + r + 1)))
    yi0 = max(0, int(math.floor(y - r - 1)))
    yi1 = min(H, int(math.ceil(y + r + 1)))
    for yi in range(yi0, yi1):
        for xi in range(xi0, xi1):
            ddx = xi + 0.5 - x
            ddy = yi + 0.5 - y
            if ddx * ddx + ddy * ddy <= r * r + 0.35:
                i = (yi * W + xi) * 4
                buf[i : i + 4] = bytes(rgba)


def stamp_disk_src_over(
    buf: bytearray,
    W: int,
    H: int,
    x: float,
    y: float,
    rad: float,
    rgba: tuple[int, int, int, int],
) -> None:
    """Src-over blend for semi-transparent ink (SVG inner ring opacity)."""
    sr, sg, sb, sa = rgba
    if sa >= 255:
        stamp_disk(buf, W, H, x, y, rad, rgba)
        return
    sa_f = sa / 255.0
    r = max(rad, 0.35)
    xi0 = max(0, int(math.floor(x - r - 1)))
    xi1 = min(W, int(math.ceil(x + r + 1)))
    yi0 = max(0, int(math.floor(y - r - 1)))
    yi1 = min(H, int(math.ceil(y + r + 1)))
    for yi in range(yi0, yi1):
        for xi in range(xi0, xi1):
            ddx = xi + 0.5 - x
            ddy = yi + 0.5 - y
            if ddx * ddx + ddy * ddy > r * r + 0.35:
                continue
            i = (yi * W + xi) * 4
            dr, dg, db, da = buf[i], buf[i + 1], buf[i + 2], buf[i + 3]
            da_f = da / 255.0
            out_a_f = sa_f + da_f * (1.0 - sa_f)
            if out_a_f < 1e-4:
                buf[i : i + 4] = b"\x00\x00\x00\x00"
                continue
            out_r = (sr * sa_f + dr * da_f * (1.0 - sa_f)) / out_a_f
            out_g = (sg * sa_f + dg * da_f * (1.0 - sa_f)) / out_a_f
            out_b = (sb * sa_f + db * da_f * (1.0 - sa_f)) / out_a_f
            buf[i] = int(max(0, min(255, round(out_r))))
            buf[i + 1] = int(max(0, min(255, round(out_g))))
            buf[i + 2] = int(max(0, min(255, round(out_b))))
            buf[i + 3] = int(max(0, min(255, round(out_a_f * 255.0))))


def thick_circle_dashed_src_over(
    buf: bytearray,
    W: int,
    H: int,
    cx: float,
    cy: float,
    rr: float,
    stroke_r: float,
    rgba: tuple[int, int, int, int],
    dash_px: float,
    gap_px: float,
) -> None:
    """Dash pattern along circle circumference (lengths in pixels, like SVG user units × S)."""
    perimeter = 2 * math.pi * rr
    if perimeter < 1e-6:
        return
    steps = max(120, int(perimeter / max(0.18, stroke_r * 0.38)))
    period = dash_px + gap_px
    if period < 1e-6:
        return
    for s in range(steps + 1):
        t = s / steps
        dist = t * perimeter
        if dist % period >= dash_px:
            continue
        ang = 2 * math.pi * t
        stamp_disk_src_over(
            buf,
            W,
            H,
            cx + rr * math.cos(ang),
            cy + rr * math.sin(ang),
            stroke_r,
            rgba,
        )


def apply_circular_mask(
    buf: bytearray, W: int, H: int, cx: float, cy: float, rad: float
) -> None:
    """Remove square canvas corners so the mark matches round menu-bar extras."""
    r2 = rad * rad
    for yi in range(H):
        for xi in range(W):
            ddx = xi + 0.5 - cx
            ddy = yi + 0.5 - cy
            if ddx * ddx + ddy * ddy > r2:
                i = (yi * W + xi) * 4
                buf[i : i + 4] = b"\x00\x00\x00\x00"


def fill_rounded_rect(
    buf: bytearray,
    W: int,
    H: int,
    cx: float,
    cy: float,
    rw: float,
    rh: float,
    rad: float,
    rgba: tuple[int, int, int, int],
) -> None:
    """Axis-aligned rounded rectangle, center (cx,cy), full width rw, full height rh."""
    hw, hh = rw / 2, rh / 2
    rad = min(rad, hw, hh)
    x0 = max(0, int(math.floor(cx - hw - 2)))
    x1 = min(W, int(math.ceil(cx + hw + 2)))
    y0 = max(0, int(math.floor(cy - hh - 2)))
    y1 = min(H, int(math.ceil(cy + hh + 2)))
    for yi in range(y0, y1):
        for xi in range(x0, x1):
            dx = abs(xi + 0.5 - cx)
            dy = abs(yi + 0.5 - cy)
            if dx > hw or dy > hh:
                continue
            inside = False
            if dx <= hw - rad and dy <= hh:
                inside = True
            elif dy <= hh - rad and dx <= hw:
                inside = True
            elif dx > hw - rad and dy > hh - rad:
                cxs = math.copysign(hw - rad, xi + 0.5 - cx)
                cys = math.copysign(hh - rad, yi + 0.5 - cy)
                ddx = xi + 0.5 - (cx + cxs)
                ddy = yi + 0.5 - (cy + cys)
                if ddx * ddx + ddy * ddy <= rad * rad + 0.5:
                    inside = True
            if inside:
                i = (yi * W + xi) * 4
                buf[i : i + 4] = bytes(rgba)


def thick_line(
    buf: bytearray,
    W: int,
    H: int,
    x0: float,
    y0: float,
    x1: float,
    y1: float,
    rgba: tuple[int, int, int, int],
    stroke_r: float,
) -> None:
    dx, dy = x1 - x0, y1 - y0
    length = math.hypot(dx, dy)
    if length < 1e-6:
        stamp_disk(buf, W, H, x0, y0, stroke_r, rgba)
        return
    # Enough samples that disks overlap (no gaps).
    n = max(3, int(math.ceil(length / max(stroke_r * 0.55, 0.4))) + 1)
    for s in range(n + 1):
        t = s / n
        x = x0 + dx * t
        y = y0 + dy * t
        stamp_disk(buf, W, H, x, y, stroke_r, rgba)


def draw_panopticon(
    buf: bytearray,
    W: int,
    H: int,
    cx: float,
    cy: float,
    S: float,
    rgba: tuple[int, int, int, int],
    *,
    stroke_radius: float | None,
    inner_dot: int | None,
    inner_dot_radius: float | None,
    tray_svg_style: bool = False,
) -> None:
    """
    Panopticon mark centered at (cx,cy) with scale S (r_out = 40*S matches watchtower-mark.svg).

    tray_svg_style: stroke widths / dash / opacity from assets/watchtower-mark.svg so the tray
    matches the in-app logo (and reads closer to other menu extras than ad-hoc thickening).
    """
    r_out, r_in = 40 * S, 14 * S
    n = 12

    def verts(r: float) -> list[tuple[float, float]]:
        return [
            (
                cx + r * math.cos(-math.pi / 2 + 2 * math.pi * i / n),
                cy + r * math.sin(-math.pi / 2 + 2 * math.pi * i / n),
            )
            for i in range(n)
        ]

    po, pi = verts(r_out), verts(r_in)

    def polyline(pts: list[tuple[float, float]], sr: float) -> None:
        for i in range(len(pts)):
            xa, ya = pts[i]
            xb, yb = pts[(i + 1) % len(pts)]
            thick_line(buf, W, H, xa, ya, xb, yb, rgba, sr)

    if tray_svg_style:
        # SVG: stroke-width 2.25 on dodecagons + radials; inner circle stroke 1.2, dash 2.2 3.2, opacity 0.45
        stroke_w = max(0.62, (2.25 * S * 0.5) * 1.12)
        inner_stroke = max(0.38, (1.2 * S * 0.5) * 1.05)
        dash_px, gap_px = 2.2 * S, 3.2 * S
        inner_a = min(255, int(round(255 * 0.45)))
        rgba_inner = (rgba[0], rgba[1], rgba[2], inner_a)

        polyline(po, stroke_w)
        polyline(pi, stroke_w)
        thick_circle_dashed_src_over(
            buf,
            W,
            H,
            cx,
            cy,
            26 * S,
            inner_stroke,
            rgba_inner,
            dash_px,
            gap_px,
        )
        for i in range(n):
            thick_line(
                buf,
                W,
                H,
                pi[i][0],
                pi[i][1],
                po[i][0],
                po[i][1],
                rgba,
                stroke_w,
            )
        return

    eff = stroke_radius if stroke_radius is not None else max(0.56, S * 0.55)
    polyline(po, eff)
    polyline(pi, eff)
    for i in range(n):
        thick_line(buf, W, H, pi[i][0], pi[i][1], po[i][0], po[i][1], rgba, eff)

    if inner_dot is not None and inner_dot_radius is not None:
        rr = 26 * S
        ir = inner_dot_radius
        rgba_i = (inner_dot, inner_dot, inner_dot, rgba[3])
        steps = max(48, int(rr * 18))
        for k in range(steps):
            ang = 2 * math.pi * k / steps
            if k % 5 < 3:
                stamp_disk(
                    buf,
                    W,
                    H,
                    cx + rr * math.cos(ang),
                    cy + rr * math.sin(ang),
                    ir,
                    rgba_i,
                )


def render_tray_template(out_w: int) -> bytes:
    """
    Menu bar template: black on transparent, geometry aligned with watchtower-mark.svg.

    Supersample then box-downsample for smooth edges; circular mask removes the square
    “box” so the extra matches round menu-bar icons (e.g. Cursor).
    """
    factor = 5
    W = out_w * factor
    H = W
    buf = bytearray([0, 0, 0, 0] * (W * H))
    # Fill most of the bitmap so after downscale the glyph matches other menu extras
    # (g=0.29 left the mark tiny inside the 64px cell).
    g = W * 0.76
    draw_panopticon(
        buf,
        W,
        H,
        W / 2,
        H / 2,
        g / 100,
        (0, 0, 0, 255),
        stroke_radius=None,
        inner_dot=None,
        inner_dot_radius=None,
        tray_svg_style=True,
    )
    small = downsample_box_rgba(buf, W, H, out_w, out_w)
    apply_circular_mask(small, out_w, out_w, out_w / 2, out_w / 2, out_w * 0.485)
    return encode_png_rgba(out_w, out_w, small)


def render_dock_icon(W: int) -> bytes:
    """Dock / .app: black rounded tile (Adobe-like) with white mark on top."""
    H = W
    buf = bytearray([0, 0, 0, 0] * (W * H))
    tile = W * 0.88
    rad = min(tile * 0.223, tile / 2)
    fill_rounded_rect(buf, W, H, W / 2, H / 2, tile, tile, rad, (0, 0, 0, 255))
    inner = tile * 0.82
    S = inner / 100
    # Base stroke for 512px tile, then ×2 for legible white lines on the black dock tile.
    stroke_base = max(1.15, min(3.2, S * 0.42))
    stroke = stroke_base * 2
    draw_panopticon(
        buf,
        W,
        H,
        W / 2,
        H / 2,
        S,
        (255, 255, 255, 255),
        stroke_radius=stroke,
        inner_dot=210,
        inner_dot_radius=max(1.0, stroke * 0.72),
        tray_svg_style=False,
    )
    return encode_png_rgba(W, H, buf)


def main() -> None:
    ASSETS.mkdir(parents=True, exist_ok=True)
    # 64px output; 5× internal supersample + SVG stroke weights + circular mask.
    (ASSETS / "trayTemplate.png").write_bytes(render_tray_template(64))
    (ASSETS / "icon.png").write_bytes(render_dock_icon(512))
    print("Wrote assets/trayTemplate.png and assets/icon.png")


if __name__ == "__main__":
    main()
