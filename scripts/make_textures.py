"""Seamless grayscale material textures for the V2 card design.

Every texture tiles: noise comes from filtered FFT white noise (periodic by construction) and
cell patterns use distances on a torus. Height maps are shaded by one key light from the upper
left, matching the design's lighting. Mid-grey (~128) means "no change" under an overlay blend.

Usage: .venv/bin/python scripts/make_textures.py <out_dir>. The game uses maple.png and
smoke.png (frontend/src/three/materials/); the others are used by the design canvas.
"""
import struct
import sys
import zlib
from pathlib import Path

import numpy as np

N = 256
rng = np.random.default_rng(20261111)
out = Path(sys.argv[1])


def png(name, img):
    a = np.clip(img, 0, 255).astype(np.uint8)
    raw = b"".join(b"\x00" + row.tobytes() for row in a)
    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    data = (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", a.shape[1], a.shape[0], 8, 0, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))
    (out / name).write_bytes(data)


def noise(beta=2.0, sx=1.0, sy=1.0):
    """Periodic 1/f^beta noise; sx > sy damps variation along x, giving streaks along x."""
    f = np.fft.fftfreq(N)
    fx, fy = np.meshgrid(f, f)
    r = np.sqrt((fx * sx) ** 2 + (fy * sy) ** 2)
    r[0, 0] = 1
    spec = np.fft.fft2(rng.standard_normal((N, N))) / r ** (beta / 2)
    spec[0, 0] = 0
    n = np.real(np.fft.ifft2(spec))
    return (n - n.mean()) / n.std()


def worley(cells):
    """F1 and F2 distances to jittered points on a torus, in pixels."""
    step = N / cells
    pts = np.array([((i + rng.random()) * step, (j + rng.random()) * step)
                    for i in range(cells) for j in range(cells)])
    y, x = np.mgrid[0:N, 0:N].astype(float)
    d = []
    for px, py in pts:
        dx = np.abs(x - px); dx = np.minimum(dx, N - dx)
        dy = np.abs(y - py); dy = np.minimum(dy, N - dy)
        d.append(np.hypot(dx, dy))
    d = np.sort(np.stack(d), axis=0)
    return d[0], d[1], step


def shade(h, strength):
    gx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) / 2
    gy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) / 2
    nx, ny, nz = -gx, -gy, np.ones_like(h)
    norm = np.sqrt(nx ** 2 + ny ** 2 + nz ** 2)
    light = np.array([-1.0, -1.0, 1.3]); light /= np.linalg.norm(light)   # upper left, image y down
    lit = (nx * light[0] + ny * light[1] + nz * light[2]) / norm
    lit -= lit.mean()
    return 128 + strength * lit / (np.abs(lit).max() + 1e-9) * 127


# Hammered metal: shallow bowls, one per jittered cell, plus fine grain.
f1, f2, step = worley(9)
hammer = (f1 / step) ** 2 * 6 + 0.08 * noise(1.2)
png("hammer.png", shade(hammer, 0.75))

# Leather: pebbled cells with creases between them.
f1, f2, step = worley(22)
crease = np.clip((f2 - f1) / step, 0, 0.35)
leather = crease * 4 + 0.15 * noise(1.6)
png("leather.png", shade(leather, 0.6))

# Walnut: horizontal grain lines bent by low-frequency noise, plus long fibres.
y = np.mgrid[0:N, 0:N][0] / N
warp = noise(3.0, sx=3.0, sy=1.0)
rings = np.sin(2 * np.pi * (6 * y + 0.12 * warp))
fibres = noise(1.2, sx=14.0, sy=1.0)
wood = 128 - 30 * np.tanh(1.6 * rings) + 14 * fibres
png("wood.png", wood)

# Brushed metal: fine streaks along x.
brushed = 128 + 20 * noise(1.0, sx=24.0, sy=1.0)
png("brushed.png", brushed)

# Smoke: soft fBm with contrast, for stealth; lighter = denser.
smoke = noise(3.2)
png("smoke.png", 128 + 75 * np.tanh(0.8 * smoke))

# Maple: faint, fine grain with soft growth lines; much less striped than walnut.
y = np.mgrid[0:N, 0:N][0] / N
warp = noise(3.0, sx=2.5, sy=1.0)
growth = np.sin(2 * np.pi * (4 * y + 0.25 * warp))
fine = noise(1.1, sx=18.0, sy=1.0)
flecks = noise(0.6, sx=5.0, sy=1.0)
png("maple.png", 128 - 8 * np.tanh(1.2 * growth) + 9 * fine + 4 * flecks)

print(*(f"{p.name} {p.stat().st_size}" for p in sorted(out.glob("*.png"))), sep="\n")
