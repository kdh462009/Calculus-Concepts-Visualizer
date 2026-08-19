#!/usr/bin/env python3
"""
Volume of revolution visualizer backend (pywebview app).
"""

from __future__ import annotations

import math

import numpy as np

from calcbc.graph import (
    launch_app,
    parse_expr,
    safe_eval,
    sample_domain,
    to_js_array,
)

FUNCTION_HINTS = [
    "sin(x)+2",
    "x**2",
    "sqrt(x+1)+1",
    "log(x+2)+2",
    "exp(0.35*x)",
    "2-x**2/4",
    "abs(x)+1",
]

PRESETS = [
    ("x^2", "x**2"),
    ("sin(x)+2", "sin(x)+2"),
    ("2 - x^2/4", "2 - x**2/4"),
    ("sqrt(x+1)+1", "sqrt(x+1)+1"),
    ("ln(x+2)+2", "log(x+2)+2"),
    ("e^(0.35x)", "exp(0.35*x)"),
]

AXES = [
    ("x", "Rotate around x-axis"),
    ("y", "Rotate around y-axis"),
]


def _numeric_integral(xs: np.ndarray, ys: np.ndarray) -> float:
    finite = np.isfinite(xs) & np.isfinite(ys)
    if np.count_nonzero(finite) < 10:
        raise ValueError("Could not estimate integral on this interval.")
    return float(np.trapezoid(ys[finite], xs[finite]))


def _volume_formula(axis: str) -> str:
    if axis == "x":
        return "V = π ∫[a,b] (f(x))^2 dx"
    return "V = 2π ∫[a,b] |x| |f(x)| dx (shell method)"


class VolumeRotationApi:
    def get_bootstrap(self):
        return {
            "hints": FUNCTION_HINTS,
            "presets": PRESETS,
            "axes": AXES,
        }

    def compute(self, payload):
        try:
            expr_text = (payload or {}).get("expr", "").strip()
            if not expr_text:
                return {"ok": False, "error": "Please enter a function."}

            axis = str((payload or {}).get("axis", "x")).strip().lower()
            a = float((payload or {}).get("a", 0.0))
            b = float((payload or {}).get("b", 2.0))
            xmin = float((payload or {}).get("xmin", min(a, b) - 2.0))
            xmax = float((payload or {}).get("xmax", max(a, b) + 2.0))
            samples = int((payload or {}).get("samples", 2000))

            if axis not in {"x", "y"}:
                return {"ok": False, "error": "Axis must be x or y."}
            if a >= b:
                return {"ok": False, "error": "Bounds must satisfy a < b."}
            if xmin >= xmax:
                return {"ok": False, "error": "xmin must be < xmax."}

            expr = parse_expr(expr_text)
            x_all = sample_domain(xmin, xmax, samples)
            y_all = safe_eval(expr, x_all, clip=1.0e9)

            x_bounds = np.linspace(a, b, max(900, samples // 2))
            y_bounds = safe_eval(expr, x_bounds, clip=1.0e9)
            valid_bounds = np.isfinite(y_bounds)
            if np.count_nonzero(valid_bounds) < 30:
                return {
                    "ok": False,
                    "error": "Function is undefined on most of the selected bounds.",
                }

            xb = x_bounds[valid_bounds]
            yb = y_bounds[valid_bounds]

            area_abs = _numeric_integral(xb, np.abs(yb))
            if axis == "x":
                volume = math.pi * _numeric_integral(xb, yb * yb)
            else:
                volume = 2.0 * math.pi * _numeric_integral(xb, np.abs(xb) * np.abs(yb))

            max_abs_y = float(np.nanmax(np.abs(y_all[np.isfinite(y_all)]))) if np.any(np.isfinite(y_all)) else 1.0
            max_abs_x = max(abs(xmin), abs(xmax))

            return {
                "ok": True,
                "x": [float(v) for v in x_all],
                "yTrue": to_js_array(y_all),
                "xRange": [xmin, xmax],
                "bounds": [a, b],
                "axis": axis,
                "xBound": [float(v) for v in x_bounds],
                "yBound": to_js_array(y_bounds),
                "area": area_abs,
                "volume": volume,
                "areaFormula": "A = ∫[a,b] |f(x)| dx",
                "volumeFormula": _volume_formula(axis),
                "assumption": "Area uses |f(x)|; y-axis rotation uses shell radius |x|.",
                "scaleHints": {
                    "maxAbsX": float(max_abs_x),
                    "maxAbsY": float(max_abs_y if max_abs_y > 1e-8 else 1.0),
                },
            }
        except Exception as exc:
            return {"ok": False, "error": f"{exc}"}


def main():
    """Launch volume rotation visualizer directly (use app.py for the full hub)."""
    launch_app(
        VolumeRotationApi(),
        "ui/volume_rotation/index.html",
        title="Volume Rotation Visualizer",
    )


if __name__ == "__main__":
    main()
