"""Draws the Voucherboard icon (white V on the portal's navy) as PNGs, with no image libraries."""
import struct, zlib, pathlib

NAVY, WHITE = (43, 73, 114), (255, 255, 255)

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

def png(n, square=False):
    rows = b""
    for y in range(n):
        row = b"\x00"
        for x in range(n):
            p = pixel(x, y, n, square)
            row += bytes(p + (255,)) if p else b"\x00\x00\x00\x00"
        rows += row
    chunk = lambda t, d: struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", n, n, 8, 6, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(rows, 9)) + chunk(b"IEND", b"")

out = pathlib.Path(__file__).resolve().parent.parent / "icons"
for n in (16, 48, 128, 192):
    (out / f"{n}.png").write_bytes(png(n))
# Home screen icons (src/homeicon.js): Apple's apple-touch-icon is a full square.
(out / "touch-180.png").write_bytes(png(180, square=True))
print("icons written")
