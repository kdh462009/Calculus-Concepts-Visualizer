#!/usr/bin/env python3
"""
Inverse visualizer backend (function, inverse, and derivatives).
"""

from __future__ import annotations

import numpy as np
import sympy as sp

from calcbc.graph import classroom_str, launch_app, parse_expr, safe_eval, sample_domain, to_js_array, x

FUNCTION_HINTS = [
    "x^3",
    "x^3 + x",
    "e^x",
    "ln(x+2)",
    "sqrt(x+3)",
    "x",
]

PRESETS = [
    ("x^3", "x^3"),
    ("x^3 + x", "x^3 + x"),
    ("e^x", "e^x"),
    ("ln(x+2)", "ln(x+2)"),
    ("sqrt(x+3)", "sqrt(x+3)"),
]


def _combined_y_range(*arrays) -> list[float]:
    vals = []
    for arr in arrays:
        if arr is None:
            continue
        a = np.asarray(arr, dtype=float)
        if a.ndim == 0:
            a = np.array([float(a)], dtype=float)
        fin = a[np.isfinite(a)]
        if fin.size:
            vals.append(fin)
    if not vals:
        return [-10.0, 10.0]
    all_vals = np.concatenate(vals)
    lo = float(np.nanpercentile(all_vals, 2))
    hi = float(np.nanpercentile(all_vals, 98))
    if not np.isfinite(lo) or not np.isfinite(hi) or hi - lo < 1e-8:
        c = float(np.nanmedian(all_vals))
        return [c - 1.0, c + 1.0]
    pad = max(0.25, 0.14 * (hi - lo))
    return [lo - pad, hi + pad]


def _monotonic_direction(y_vals: np.ndarray) -> str | None:
    dy = np.diff(y_vals)
    if dy.size == 0:
        return None
    span = max(float(np.nanmax(y_vals) - np.nanmin(y_vals)), 1.0)
    tol = 1e-7 * span
    if np.all(dy >= -tol):
        return "increasing"
    if np.all(dy <= tol):
        return "decreasing"
    return None


def _build_inverse_curves(x_grid: np.ndarray, y_true: np.ndarray, y_prime: np.ndarray):
    valid = np.isfinite(x_grid) & np.isfinite(y_true)
    if np.count_nonzero(valid) < 30:
        raise ValueError("Not enough valid points to build inverse curve.")

    x_valid = x_grid[valid]
    y_valid = y_true[valid]
    d_valid = y_prime[valid]

    direction = _monotonic_direction(y_valid)
    if direction is None:
        raise ValueError("Function is not monotonic on this window. Choose a monotonic interval.")

    if direction == "decreasing":
        x_valid = x_valid[::-1]
        y_valid = y_valid[::-1]
        d_valid = d_valid[::-1]

    y_unique, idx = np.unique(y_valid, return_index=True)
    x_unique = x_valid[idx]
    d_unique = d_valid[idx]

    inv_f = np.full_like(x_grid, np.nan, dtype=float)
    inv_prime = np.full_like(x_grid, np.nan, dtype=float)
    in_support = (x_grid >= y_unique[0]) & (x_grid <= y_unique[-1])
    if np.any(in_support):
        inv_f[in_support] = np.interp(x_grid[in_support], y_unique, x_unique)
        deriv_at_inv = np.interp(x_grid[in_support], y_unique, d_unique)
        with np.errstate(divide="ignore", invalid="ignore", over="ignore", under="ignore"):
            inv_prime[in_support] = 1.0 / deriv_at_inv
        inv_prime[~np.isfinite(inv_prime)] = np.nan
        inv_prime[np.abs(inv_prime) > 1.0e6] = np.nan

    return inv_f, inv_prime, direction


class InverseApi:
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

            xmin = float((payload or {}).get("xmin", -4.0))
            xmax = float((payload or {}).get("xmax", 4.0))
            samples = int((payload or {}).get("samples", 1800))
            if xmin >= xmax:
                return {"ok": False, "error": "xmin must be < xmax."}

            expr = parse_expr(expr_text)
            deriv_expr = sp.simplify(sp.diff(expr, x))
            x_grid = sample_domain(xmin, xmax, samples)
            y_true = safe_eval(expr, x_grid, clip=1.0e6)
            y_prime = safe_eval(deriv_expr, x_grid, clip=1.0e6)
            inv_f, inv_prime, monotonicity = _build_inverse_curves(x_grid, y_true, y_prime)
            mirror_line = x_grid.astype(float)

            y_range = _combined_y_range(y_true, inv_f, y_prime, inv_prime, mirror_line)
            y_range_fn = _combined_y_range(y_true)
            y_range_inv = _combined_y_range(inv_f, mirror_line)
            y_range_inv_prime = _combined_y_range(y_true, inv_f, y_prime, inv_prime)

            return {
                "ok": True,
                "x": [float(v) for v in x_grid],
                "xRange": [xmin, xmax],
                "yRange": y_range,
                "yTrue": to_js_array(y_true),
                "yInverse": to_js_array(inv_f),
                "yPrime": to_js_array(y_prime),
                "yInversePrime": to_js_array(inv_prime),
                "yMirror": to_js_array(mirror_line),
                "derivativeExpr": classroom_str(deriv_expr),
                "inverseDerivativeRule": "(f^{-1})'(x) = 1 / f'(f^{-1}(x))",
                "monotonicity": monotonicity,
                "phaseYRanges": {
                    "function": y_range_fn,
                    "inverse": y_range_inv,
                    "inverseDerivative": y_range_inv_prime,
                    "full": y_range,
                },
            }
        except Exception as exc:
            return {"ok": False, "error": f"{exc}"}


def main():
    """Launch inverse visualizer directly (use app.py for the full hub)."""
    launch_app(
        InverseApi(),
        "ui/inverse/index.html",
        title="Inverse Visualizer",
    )


if __name__ == "__main__":
    main()
