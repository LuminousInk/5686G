#!/usr/bin/env python3
"""Re-encode the Radiance .hdr skies as lossless WebP so web hosts that only serve web formats can carry them.

Layout of <name>.webp (width W, height 2H, RGB, lossless):
  rows 0..H-1   R, G, B mantissas of the RGBE encoding
  rows H..2H-1  the shared exponent E (in all three channels)
Decoded in the browser (src/engine/env/environment.ts): value = (m + 0.5) / 256 * 2^(E - 128), 0 when E == 0.

    python3 tools/encode_hdri.py            # every .cache/raw/hdri/*.hdr -> public/assets/hdri/*.webp
"""
from __future__ import annotations

import glob
import os

import cv2
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, '.cache', 'raw', 'hdri')
OUT = os.path.join(ROOT, 'public', 'assets', 'hdri')


def rgbe(rgb: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    m = rgb.max(axis=2)
    frac, exp = np.frexp(m)
    valid = m > 1e-32
    scale = np.where(valid, frac * 256.0 / np.maximum(m, 1e-32), 0)
    mant = np.clip(np.floor(rgb * scale[..., None]), 0, 255).astype(np.uint8)
    e = np.where(valid, exp + 128, 0).clip(0, 255).astype(np.uint8)
    return mant, e


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    for f in sorted(glob.glob(os.path.join(SRC, '*.hdr'))):
        img = cv2.imread(f, cv2.IMREAD_UNCHANGED)[:, :, ::-1].astype(np.float32)  # BGR -> RGB
        h, w, _ = img.shape
        mant, e = rgbe(img)
        packed = np.zeros((h * 2, w, 3), np.uint8)
        packed[:h] = mant
        packed[h:] = e[..., None]
        name = os.path.splitext(os.path.basename(f))[0]
        out = os.path.join(OUT, f'{name}.webp')
        Image.fromarray(packed, 'RGB').save(out, 'WEBP', lossless=True, quality=100, method=6)
        # verify round trip on the brightest pixel
        dec = np.array(Image.open(out).convert('RGB'))
        m2, e2 = dec[:h].astype(np.float32), dec[h:, :, 0].astype(np.float32)
        val = np.where(e2[..., None] > 0, (m2 + 0.5) / 256 * np.exp2(e2[..., None] - 128), 0)
        i = np.unravel_index(img.max(axis=2).argmax(), (h, w))
        print(f'{name}: {os.path.getsize(out) / 1e6:.2f} MB  max {img[i].round(1)} -> {val[i].round(1)}')


if __name__ == '__main__':
    main()
