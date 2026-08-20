#!/usr/bin/env python3
"""Fourier epicycle engine: closed curve → complex DFT → rotating phasors.

Uses numpy.fft with signed frequencies so the continuous reconstruction
rotates at the right speed (FFT bin N-1 is frequency −1, not N−1).
"""

from __future__ import annotations

import numpy as np

from calcbc.graph import launch_app
from calcbc.latex_formulas import fourier_reconstruction_latex, render_formula

N_MIN = 64
N_MAX = 2048
N_DEFAULT = 512
AMP_EPS = 1e-12

PRESETS = [
    {"id": "heart", "label": "Heart"},
    {"id": "star", "label": "Star"},
    {"id": "sigma", "label": "Σ path"},
    {"id": "chaos", "label": "Chaos"},
]


def nearest_pow2(value, lo=N_MIN, hi=N_MAX) -> int:
    n = int(np.clip(round(float(value)), lo, hi))
    lo_p = 1 << (n.bit_length() - 1)
    hi_p = min(lo_p << 1, hi)
    if hi_p <= lo_p:
        return int(np.clip(lo_p, lo, hi))
    return lo_p if n - lo_p <= hi_p - n else hi_p


def _finite_xy(raw) -> list[tuple[float, float]]:
    points = []
    for item in raw or []:
        if isinstance(item, dict):
            x, y = item.get("x"), item.get("y")
        elif isinstance(item, (list, tuple)) and len(item) >= 2:
            x, y = item[0], item[1]
        else:
            continue
        try:
            xf, yf = float(x), float(y)
        except (TypeError, ValueError):
            continue
        if np.isfinite(xf) and np.isfinite(yf):
            points.append((xf, yf))
    return points


def _close_path(pts: list[tuple[float, float]]) -> list[tuple[float, float]]:
    if len(pts) < 2:
        return pts
    ax, ay = pts[0]
    bx, by = pts[-1]
    if np.hypot(ax - bx, ay - by) > 2:
        return pts + [pts[0]]
    return pts


def _dense_polyline(verts: np.ndarray, per_seg: int = 36) -> np.ndarray:
    """Linearly densify a closed (or open) polyline."""
    if verts.shape[0] < 2:
        return verts
    chunks = []
    last = verts.shape[0] - 1
    for i in range(last):
        a = verts[i]
        b = verts[i + 1]
        n = max(2, int(per_seg))
        t = np.linspace(0.0, 1.0, n, endpoint=(i == last - 1))
        chunks.append(a[None, :] * (1 - t[:, None]) + b[None, :] * t[:, None])
    return np.vstack(chunks)


def _math_to_screen(xy: np.ndarray, width: float, height: float) -> list[dict]:
    """Map y-up math coords (roughly unit disk) onto canvas CSS pixels."""
    w = max(float(width), 1.0)
    h = max(float(height), 1.0)
    scale = min(w, h) * 0.42
    cx, cy = w * 0.5, h * 0.5
    out = []
    for x, y in xy:
        out.append({"x": cx + float(x) * scale, "y": cy - float(y) * scale})
    return out


def preset_heart() -> np.ndarray:
    t = np.linspace(0.0, 2 * np.pi, 361)
    x = 16 * np.sin(t) ** 3
    y = 13 * np.cos(t) - 5 * np.cos(2 * t) - 2 * np.cos(3 * t) - np.cos(4 * t)
    xy = np.column_stack((x / 16.0, y / 16.0))
    return xy * 0.92


def preset_star() -> np.ndarray:
    points = 5
    n = points * 2
    ang = -np.pi / 2 + np.linspace(0.0, 2 * np.pi, n + 1)
    r = np.where(np.arange(n + 1) % 2 == 0, 0.92, 0.92 * 0.42)
    xy = np.column_stack((r * np.cos(ang), r * np.sin(ang)))
    return _dense_polyline(xy, per_seg=48)


def preset_sigma() -> np.ndarray:
    """Closed outline of a capital Σ (not a rectangle)."""
    verts = np.array(
        [
            [-0.95, 1.00],
            [0.95, 1.00],
            [0.95, 0.76],
            [-0.22, 0.76],
            [0.36, 0.02],
            [-0.22, -0.76],
            [0.95, -0.76],
            [0.95, -1.00],
            [-0.95, -1.00],
            [-0.95, -0.72],
            [0.10, 0.00],
            [-0.95, 0.72],
            [-0.95, 1.00],
        ],
        dtype=float,
    )
    return _dense_polyline(verts, per_seg=40) * 0.88


def preset_chaos(seed=None) -> np.ndarray:
    rng = np.random.default_rng(seed)
    n = 96
    t = np.linspace(0.0, 2 * np.pi, n, endpoint=False)
    r = (
        0.62
        + 0.16 * np.sin(2 * t + rng.uniform(0, 2 * np.pi))
        + 0.11 * np.sin(3 * t + rng.uniform(0, 2 * np.pi))
        + 0.08 * np.sin(5 * t + rng.uniform(0, 2 * np.pi))
        + 0.05 * rng.normal(size=n)
    )
    r = np.clip(r, 0.28, 1.05)
    xy = np.column_stack((r * np.cos(t), r * np.sin(t)))
    xy = np.vstack((xy, xy[0]))
    return _dense_polyline(xy, per_seg=8)


PRESET_BUILDERS = {
    "heart": lambda: preset_heart(),
    "star": lambda: preset_star(),
    "sigma": lambda: preset_sigma(),
    "chaos": lambda: preset_chaos(),
}


def resample_closed(points, n: int) -> np.ndarray | None:
    """Arc-length resample a closed screen polyline to N complex samples.

    Screen y is down. Result is centered, y-up, scaled so max radius is 1.
    """
    pts = _close_path(list(points))
    if len(pts) < 2:
        return None
    arr = np.asarray(pts, dtype=float)
    seg = np.diff(arr, axis=0)
    seg_len = np.hypot(seg[:, 0], seg[:, 1])
    total = float(np.sum(seg_len))
    if total < 1e-6:
        return None

    want = (total * np.arange(n, dtype=float)) / n
    cum = np.concatenate(([0.0], np.cumsum(seg_len)))
    # Last sample sits on the first vertex (closed curve).
    xs = np.interp(want, cum, arr[:, 0])
    ys = np.interp(want, cum, arr[:, 1])

    cx = float(np.mean(xs))
    cy = float(np.mean(ys))
    dx = xs - cx
    dy = -(ys - cy)
    max_r = float(np.max(np.hypot(dx, dy)))
    if max_r < 1e-9:
        return None
    return (dx + 1j * dy) / max_r


def signed_freq(k: int, n: int) -> int:
    return k if k <= n // 2 else k - n


def _c_js(z: complex) -> dict:
    return {"re": float(z.real), "im": float(z.imag)}


def analyze_samples(z: np.ndarray, *, include_samples: bool = False) -> dict:
    n = int(z.size)
    spectrum = np.fft.fft(z)
    coeffs = spectrum / n
    dc = coeffs[0]
    terms = []
    for k in range(1, n):
        ck = coeffs[k]
        amp = float(np.abs(ck))
        if amp < AMP_EPS:
            continue
        freq = signed_freq(k, n)
        terms.append(
            {
                "k": int(freq),
                "bin": int(k),
                "amp": amp,
                "phase": float(np.angle(ck)),
                "re": float(ck.real),
                "im": float(ck.imag),
            }
        )
    terms.sort(key=lambda item: item["amp"], reverse=True)
    result = {
        "ok": True,
        "n": n,
        "dc": _c_js(dc),
        "terms": terms,
        "termCount": len(terms),
    }
    if include_samples:
        result["samples"] = [{"re": float(v.real), "im": float(v.imag)} for v in z]
    return result


def compute_from_points(payload: dict | None) -> dict:
    data = payload or {}
    points = _finite_xy(data.get("points"))
    if len(points) < 3:
        return {"ok": False, "error": "Draw a closed curve with at least 3 points."}
    n = nearest_pow2(data.get("n", N_DEFAULT))
    z = resample_closed(points, n)
    if z is None:
        return {"ok": False, "error": "Path is too small to sample. Draw a larger shape."}
    result = analyze_samples(z, include_samples=True)
    result["pointCount"] = len(points)
    return result


def build_preset(preset_id: str, width: float, height: float) -> dict:
    builder = PRESET_BUILDERS.get(str(preset_id or "").strip().lower())
    if builder is None:
        return {"ok": False, "error": f"Unknown preset: {preset_id!r}"}
    xy = builder()
    return {"ok": True, "id": preset_id, "points": _math_to_screen(xy, width, height)}


class FourierApi:
    def get_bootstrap(self):
        return {
            "presets": PRESETS,
            "nMin": N_MIN,
            "nMax": N_MAX,
            "nDefault": N_DEFAULT,
            "latexPng": render_formula(fourier_reconstruction_latex(), wide=True),
        }

    def get_preset(self, payload):
        data = payload or {}
        try:
            width = float(data.get("width") or 0)
            height = float(data.get("height") or 0)
        except (TypeError, ValueError):
            return {"ok": False, "error": "Canvas size is invalid."}
        if width < 2 or height < 2:
            return {"ok": False, "error": "Canvas is not ready yet."}
        return build_preset(data.get("id"), width, height)

    def compute(self, payload):
        try:
            return compute_from_points(payload)
        except Exception as exc:
            return {"ok": False, "error": f"{exc}"}


def main():
    launch_app(
        FourierApi(),
        "ui/fourier/index.html",
        title="Fourier Epicycles",
    )


if __name__ == "__main__":
    main()
