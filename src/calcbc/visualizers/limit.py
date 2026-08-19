#!/usr/bin/env python3
"""
Limit visualizer backend (epsilon-delta animation support).
"""

from __future__ import annotations

import numpy as np

from calcbc.graph import (
    launch_app,
    parse_expr,
    safe_eval,
    sample_domain,
    to_js_array,
    x,
)

FUNCTION_HINTS = [
    "(x**2-1)/(x-1)",
    "sin(x)/x",
    "(1-cos(x))/x",
    "log(1+x)/x",
    "(exp(x)-1)/x",
    "abs(x)",
    "x**2",
]

PRESETS = [
    ("(x^2-1)/(x-1), a=1", "(x**2-1)/(x-1)", 1.0),
    ("sin(x)/x, a=0", "sin(x)/x", 0.0),
    ("(1-cos(x))/x, a=0", "(1-cos(x))/x", 0.0),
    ("ln(1+x)/x, a=0", "log(1+x)/x", 0.0),
    ("(e^x-1)/x, a=0", "(exp(x)-1)/x", 0.0),
]


_LIMIT_CLIP = 1.0e9


def _side_limit(expr, xs: np.ndarray) -> tuple[float | None, float]:
    """Median and spread of f on samples approaching a from one side."""
    y = safe_eval(expr, xs, clip=_LIMIT_CLIP)
    # Closest samples are first when xs is built from increasing |h|.
    n_close = max(8, xs.size // 3)
    close = y[:n_close]
    finite = close[np.isfinite(close)]
    if finite.size < 5:
        finite = y[np.isfinite(y)]
    if finite.size < 5:
        return None, float("inf")
    if np.count_nonzero(np.abs(finite) >= _LIMIT_CLIP * 0.5) >= max(3, finite.size // 5):
        return None, float("inf")
    med = float(np.median(finite))
    spread = float(np.percentile(np.abs(finite - med), 85))
    return med, spread


def _estimate_limit(expr, a: float, radius: float) -> float | None:
    """Two-sided numerical limit. Returns None if sides disagree, blow up, or oscillate."""
    h_min = max(abs(a) * 1e-8, 1e-8)
    h_max = max(min(max(radius, 1e-3) * 0.08, 0.25), h_min * 10.0)
    hs = np.geomspace(h_min, h_max, 64)
    left_med, left_spread = _side_limit(expr, a - hs)
    right_med, right_spread = _side_limit(expr, a + hs)
    if left_med is None or right_med is None:
        return None
    scale = max(abs(left_med), abs(right_med), 1.0)
    if left_spread > 0.2 * scale or right_spread > 0.2 * scale:
        return None
    if abs(left_med - right_med) > max(0.08 * scale, 1e-3):
        return None
    return float(0.5 * (left_med + right_med))


def _delta_for_epsilon(expr, a: float, limit_val: float, epsilon: float, max_radius: float) -> float:
    if epsilon <= 0:
        return 0.0
    hs = np.geomspace(max(max_radius * 1e-6, 1e-6), max(max_radius, 1e-4), 280)
    left_y = safe_eval(expr, a - hs, clip=1.0e9)
    right_y = safe_eval(expr, a + hs, clip=1.0e9)

    delta = 0.0
    for i, h in enumerate(hs):
        lv = left_y[i]
        rv = right_y[i]
        if not np.isfinite(lv) or not np.isfinite(rv):
            break
        if abs(lv - limit_val) < epsilon and abs(rv - limit_val) < epsilon:
            delta = float(h)
        else:
            break
    return float(min(delta, max_radius))


class LimitApi:
    def get_bootstrap(self):
        return {
            "hints": FUNCTION_HINTS,
            "presets": PRESETS,
        }

    def compute(self, payload):
        try:
            expr_text = (payload or {}).get("expr", "").strip()
            if not expr_text:
                return {"ok": False, "error": "Please enter a function."}

            a = float((payload or {}).get("a", 0.0))
            xmin = float((payload or {}).get("xmin", a - 3.0))
            xmax = float((payload or {}).get("xmax", a + 3.0))
            samples = int((payload or {}).get("samples", 2200))
            eps_start = float((payload or {}).get("epsStart", 1.0))
            eps_end = float((payload or {}).get("epsEnd", 0.1))
            manual_limit = (payload or {}).get("limitValue", None)

            if xmin >= xmax:
                return {"ok": False, "error": "xmin must be < xmax."}
            if eps_start <= 0 or eps_end <= 0:
                return {"ok": False, "error": "Epsilon values must be > 0."}

            expr = parse_expr(expr_text)
            x_vals = sample_domain(xmin, xmax, samples)
            y_vals = safe_eval(expr, x_vals, clip=1.0e9)

            radius = max(1e-4, 0.45 * (xmax - xmin))
            est_limit = _estimate_limit(expr, a, radius)
            if manual_limit is None or manual_limit == "":
                limit_val = est_limit
            else:
                limit_val = float(manual_limit)

            if limit_val is None:
                return {
                    "ok": False,
                    "error": "No finite two-sided limit at a (left/right disagree, or f blows up/oscillates). Enter L only to test a candidate.",
                }

            if eps_start < eps_end:
                eps_start, eps_end = eps_end, eps_start

            eps_path = np.linspace(eps_start, eps_end, 110)
            max_radius = min(abs(a - xmin), abs(xmax - a))
            if max_radius <= 0:
                max_radius = 0.5 * (xmax - xmin)
            deltas = [_delta_for_epsilon(expr, a, limit_val, float(e), max_radius) for e in eps_path]

            y_at_a = safe_eval(expr, np.array([a], dtype=float), clip=1.0e9)[0]
            y_at_a_val = float(y_at_a) if np.isfinite(y_at_a) else None

            return {
                "ok": True,
                "x": [float(v) for v in x_vals],
                "yTrue": to_js_array(y_vals),
                "xRange": [xmin, xmax],
                "a": a,
                "limitValue": float(limit_val),
                "estimatedLimit": float(est_limit) if est_limit is not None else None,
                "fAtA": y_at_a_val,
                "epsPath": [float(v) for v in eps_path],
                "deltaPath": [float(v) for v in deltas],
                "definitionText": "If x is close enough to a, then f(x) stays close to L.",
            }
        except Exception as exc:
            return {"ok": False, "error": f"{exc}"}


def main():
    """Launch limit visualizer directly (use app.py for the full hub)."""
    launch_app(
        LimitApi(),
        "ui/limit/index.html",
        title="Limit Visualizer",
    )


if __name__ == "__main__":
    main()
