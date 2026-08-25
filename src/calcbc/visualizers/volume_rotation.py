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
from calcbc.latex_formulas import render_formula, volume_formulas_latex

FUNCTION_HINTS = [
    "sin(x)+2",
    "x^2",
    "sqrt(x+1)+1",
    "ln(x+2)+2",
    "e^(0.35x)",
    "2-x^2/4",
    "abs(x)+1",
]

PRESETS = [
    ("x^2", "x^2"),
    ("sin(x)+2", "sin(x)+2"),
    ("2 - x^2/4", "2 - x^2/4"),
    ("sqrt(x+1)+1", "sqrt(x+1)+1"),
    ("ln(x+2)+2", "ln(x+2)+2"),
    ("e^(0.35x)", "e^(0.35x)"),
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


def _invert_to_y(xb: np.ndarray, yb: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Sample x as a function of y on a monotonic grid (washer method).

    Interpolates along the polyline (x, f(x)). Where several x values share a
    height, keep the one farthest from the y-axis (region from the axis to the curve).
    """
    finite = np.isfinite(xb) & np.isfinite(yb)
    x = np.asarray(xb[finite], dtype=float)
    y = np.asarray(yb[finite], dtype=float)
    if x.size < 10:
        raise ValueError("Could not invert y = f(x) on this interval.")
    y_lo = float(np.min(y))
    y_hi = float(np.max(y))
    if not np.isfinite(y_lo) or not np.isfinite(y_hi) or abs(y_hi - y_lo) < 1e-12:
        raise ValueError("y = f(x) is too flat to integrate with respect to y.")
    n = int(min(1200, max(80, x.size // 2)))
    y_grid = np.linspace(y_lo, y_hi, n)
    x_at = np.full(n, np.nan)
    for i in range(x.size - 1):
        y0 = float(y[i])
        y1 = float(y[i + 1])
        x0 = float(x[i])
        x1 = float(x[i + 1])
        dy = y1 - y0
        if abs(dy) < 1e-15:
            continue
        lo = min(y0, y1)
        hi = max(y0, y1)
        mask = (y_grid >= lo) & (y_grid <= hi)
        if not np.any(mask):
            continue
        t = (y_grid[mask] - y0) / dy
        x_seg = x0 + t * (x1 - x0)
        prev = x_at[mask]
        better = np.isnan(prev) | (np.abs(x_seg) >= np.abs(prev))
        if not np.any(better):
            continue
        idx = np.flatnonzero(mask)[better]
        x_at[idx] = x_seg[better]
    good = np.isfinite(x_at)
    if np.count_nonzero(good) < 10:
        raise ValueError("Could not invert y = f(x) on this interval.")
    return y_grid[good], x_at[good]


def _volume_formula(axis: str) -> str:
    if axis == "x":
        return "V = π ∫[a,b] (f(x))^2 dx"
    return "V = π ∫ (x(y))^2 dy (about the y-axis)"


def _volume_latex(a: float, b: float, axis: str) -> str:
    return volume_formulas_latex(a, b, axis)


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

            if axis == "x":
                area_abs = _numeric_integral(xb, np.abs(yb))
                volume = math.pi * _numeric_integral(xb, yb * yb)
                area_formula = "A = ∫[a,b] |f(x)| dx"
            else:
                y_inv, x_inv = _invert_to_y(xb, yb)
                area_abs = _numeric_integral(y_inv, np.abs(x_inv))
                volume = math.pi * _numeric_integral(y_inv, x_inv * x_inv)
                area_formula = "A = ∫ |x| dy (between curve and y-axis)"

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
                "areaFormula": area_formula,
                "volumeFormula": _volume_formula(axis),
                "latexPng": render_formula(_volume_latex(a, b, axis), wide=True),
                "assumption": (
                    "x-axis uses disks under y=f(x). "
                    "y-axis uses washers from the y-axis to the curve."
                ),
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
