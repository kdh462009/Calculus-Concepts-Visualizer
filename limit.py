#!/usr/bin/env python3
"""
Limit visualizer backend (epsilon-delta animation support).
"""

from __future__ import annotations

import numpy as np

from graph import (
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


def _estimate_limit(expr, a: float, radius: float) -> float | None:
    hs = np.geomspace(max(radius * 1e-6, 1e-6), max(radius * 0.6, 1e-4), 120)
    left_x = a - hs
    right_x = a + hs
    left_y = safe_eval(expr, left_x, clip=1.0e9)
    right_y = safe_eval(expr, right_x, clip=1.0e9)
    vals = np.concatenate([left_y[np.isfinite(left_y)], right_y[np.isfinite(right_y)]])
    if vals.size < 20:
        return None
    # Robust estimate against outliers near discontinuities.
    return float(np.median(vals))


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
                return {"ok": False, "error": "Could not estimate a finite limit near a. Provide L manually."}

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
                "definitionText": "For every ε > 0, there exists δ > 0 such that 0 < |x-a| < δ implies |f(x)-L| < ε.",
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
