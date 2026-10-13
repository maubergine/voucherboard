"""Draws the Voucherboard icon (white V on the portal's navy) as PNGs, with no image libraries. The Safari app's icon
adds an extension badge, so it isn't mistaken for a full Voucherboard app."""
import struct, zlib, pathlib

NAVY, WHITE, BLUE = (43, 73, 114), (255, 255, 255), (10, 132, 255)

def pixel(x, y, n, square=False):
    u, v = (x + .5) / n, (y + .5) / n
    r = .2  # rounded corners; square for Apple's touch icon, which the system rounds itself
    cx, cy = min(max(u, r), 1 - r), min(max(v, r), 1 - r)
    if not square and (u - cx) ** 2 + (v - cy) ** 2 > r * r:
        return None
    # a "V": two strokes from the top corners to the bottom centre
    if .22 <= v <= .78:
        t = (v - .22) / .56
        left, right = .24 + t * .26, .76 - t * .26
        w = .075
        if abs(u - left) < w or abs(u - right) < w:
            return WHITE
    return NAVY

def badge(u, v):
    """A puzzle piece on a blue disc with a white ring, at the bottom right, or None outside it."""
    r, cx, cy = .17, .73, .73
    d2 = (u - cx) ** 2 + (v - cy) ** 2
    if d2 > r * r:
        return None
    if d2 > (r - .025) ** 2:
        return WHITE
    x, y = (u - cx) / r + .06, (v - cy) / r - .06  # disc units; the piece's knobs reach up and right
    k = .19
    if (abs(x) <= .4 and abs(y) <= .4) or x * x + (y + .4) ** 2 <= k * k or (x - .4) ** 2 + y * y <= k * k:
        return WHITE
    return BLUE

def safari_pixel(x, y, n, ss=3):
    """badge over pixel(), square (the system rounds it), averaged over ss x ss samples per pixel."""
    acc = [0, 0, 0]
    for i in range(ss):
        for j in range(ss):
            u, v = (x + (i + .5) / ss) / n, (y + (j + .5) / ss) / n
            c = badge(u, v) or pixel(u * n - .5, v * n - .5, n, square=True)
            acc = [a + b for a, b in zip(acc, c)]
    return tuple(round(a / ss / ss) for a in acc)

def png(n, square=False, draw=None):
    rows = b""
    for y in range(n):
        row = b"\x00"
        for x in range(n):
            p = draw(x, y, n) if draw else pixel(x, y, n, square)
            row += bytes(p + (255,)) if p else b"\x00\x00\x00\x00"
        rows += row
    chunk = lambda t, d: struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", n, n, 8, 6, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(rows, 9)) + chunk(b"IEND", b"")

out = pathlib.Path(__file__).resolve().parent.parent / "icons"
for n in (16, 48, 128, 192):
    (out / f"{n}.png").write_bytes(png(n))
# Home screen icons (src/homeicon.js): Apple's apple-touch-icon is a full square.
(out / "touch-180.png").write_bytes(png(180, square=True))
# The Safari app (safari/project.yml): Voucherboard's icon with the extension badge.
mac = out.parent / "safari/App/Assets.xcassets/AppIcon.appiconset"
for n in (16, 32, 128, 256, 512):
    for scale in (1, 2):
        (mac / f"icon-{n}{'@2x' if scale == 2 else ''}.png").write_bytes(png(n * scale, draw=safari_pixel))
print("icons written")
