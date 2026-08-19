#!/usr/bin/env python3
"""
Riemann sum approximation visualizer backend (pywebview app).
"""

from __future__ import annotations

import numpy as np

from calcbc.graph import (
    compute_function_preview,
    launch_app,
    parse_expr,
    plot_payload,
    safe_eval,
    sample_domain,
    x,
)

FUNCTION_HINTS = [
    "sin(x)",
    "cos(x)",
    "tan(x)",
    "exp(x)",
    "log(x)",
    "x**2",
    "x**3 - x",
    "sqrt(x+1)",
    "1/(1+x**2)",
    "abs(x)",
]

PRESETS = [
    ("sin(x)", "sin(x)"),
    ("x^2", "x**2"),
    ("x^3 - x", "x**3 - x"),
    ("e^x", "exp(x)"),
    ("ln(x+2)", "log(x+2)"),
    ("1/(1+x^2)", "1/(1+x**2)"),
    ("sqrt(x+1)", "sqrt(x+1)"),
    ("|x|", "abs(x)"),
]

SUM_TYPES = [
    ("left", "Left"),
    ("right", "Right"),
    ("midpoint", "Midpoint"),
    ("trapezoidal", "Trapezoidal"),
]


def _eval_for_integral(expr, xs: np.ndarray) -> np.ndarray:
    """Sample f for quadrature — do not insert plot-only jump/clip NaNs."""
    return safe_eval(expr, xs, clip=None, break_jumps=False)


def _reject_if_singular(xs: np.ndarray, ys: np.ndarray, *, label: str) -> None:
    """Refuse Cauchy principal-value stand-ins for blow-ups and interior holes."""
    if xs.size < 8:
        raise ValueError(f"{label} could not be estimated on this interval.")
    interior = ys[1:-1]
    if np.any(~np.isfinite(interior)):
        raise ValueError(
            f"{label} is undefined or unbounded inside (a, b). "
            "The definite integral may not exist as a proper Riemann integral."
        )
    finite = ys[np.isfinite(ys)]
    if finite.size < max(10, xs.size // 3):
        raise ValueError(f"{label} could not be estimated on this interval.")
    for i in range(ys.size - 1):
        left, right = ys[i], ys[i + 1]
        if not (np.isfinite(left) and np.isfinite(right)):
            continue
        if left * right < 0 and abs(left) > 20 and abs(right) > 20 and abs(right - left) > 40:
            raise ValueError(
                f"{label} appears to have a vertical asymptote on [a, b]. "
                "The definite integral may not exist as a proper Riemann integral."
            )


def _trapezoid_skip_endpoint_nans(xs: np.ndarray, ys: np.ndarray, *, label: str) -> float:
    """Integrate after dropping non-finite endpoints only (not interior holes)."""
    lo, hi = 0, ys.size - 1
    while lo <= hi and not np.isfinite(ys[lo]):
        lo += 1
    while hi >= lo and not np.isfinite(ys[hi]):
        hi -= 1
    if hi - lo + 1 < 8:
        raise ValueError(f"{label} could not be estimated on this interval.")
    value = float(np.trapezoid(ys[lo : hi + 1], xs[lo : hi + 1]))
    if not np.isfinite(value):
        raise ValueError(f"{label} could not be estimated on this interval.")
    return value


def _high_res_integral(expr, a: float, b: float) -> float:
    xs = np.linspace(a, b, 24000)
    ys = _eval_for_integral(expr, xs)
    _reject_if_singular(xs, ys, label="Integral")
    return _trapezoid_skip_endpoint_nans(xs, ys, label="Integral")


def _integral_abs_f(expr, a: float, b: float) -> float:
    """Total area under |f| on [a, b] — stable scale when ∫f ≈ 0."""
    xs = np.linspace(a, b, 24000)
    signed = _eval_for_integral(expr, xs)
    _reject_if_singular(xs, signed, label="Area scale")
    return _trapezoid_skip_endpoint_nans(xs, np.abs(signed), label="Area scale")


def _riemann_estimate(expr, a: float, b: float, n: int, sum_type: str) -> float:
    if n < 1:
        n = 1
    dx = (b - a) / n

    if sum_type == "left":
        points = a + dx * np.arange(0, n)
        ys = _eval_for_integral(expr, points)
        return float(np.nansum(ys) * dx)

    if sum_type == "right":
        points = a + dx * np.arange(1, n + 1)
        ys = _eval_for_integral(expr, points)
        return float(np.nansum(ys) * dx)

    if sum_type == "midpoint":
        points = a + dx * (np.arange(0, n) + 0.5)
        ys = _eval_for_integral(expr, points)
        return float(np.nansum(ys) * dx)

    if sum_type == "trapezoidal":
        points = a + dx * np.arange(0, n + 1)
        ys = _eval_for_integral(expr, points)
        if len(ys) < 2:
            return float("nan")
        return float((ys[0] + ys[-1] + 2.0 * np.nansum(ys[1:-1])) * dx * 0.5)

    raise ValueError("Unknown sum type.")


def _error_percent(error_value: float, integral_ref: float, abs_f_integral: float) -> tuple[float, str]:
    """
    Percent error with a stable denominator.

    When ∫f ≈ 0 but ∫|f| is not (e.g. cos x on [0, π]), scale by ∫|f| instead of ∫f.
    """
    abs_err = abs(error_value)
    abs_int = abs(integral_ref)
    abs_area = abs(abs_f_integral)

    if abs_err < 1e-12 and abs_int < 1e-12:
        return 0.0, "exact"

    if abs_area > 1e-9 and abs_int < 0.05 * abs_area:
        return abs_err / abs_area * 100.0, "area"

    if abs_int > 1e-6:
        return abs_err / abs_int * 100.0, "integral"

    estimate = integral_ref + error_value
    return abs_err / max(abs(estimate), 1e-9) * 100.0, "sum"


class RiemannApi:
    def get_bootstrap(self):
        return {
            "hints": FUNCTION_HINTS,
            "presets": PRESETS,
            "sumTypes": SUM_TYPES,
        }

    def preview(self, payload):
        return compute_function_preview(payload)

    def preview_function(self, payload):
        return self.preview(payload)

    def compute(self, payload):
        try:
            expr_text = (payload or {}).get("expr", "").strip()
            if not expr_text:
                return {"ok": False, "error": "Please enter a function."}

            a = float((payload or {}).get("a", 0.0))
            b = float((payload or {}).get("b", 4.0))
            n = int((payload or {}).get("n", 12))
            sum_type = str((payload or {}).get("sumType", "left")).strip().lower()
            xmin = float((payload or {}).get("xmin", min(a, b) - 1.0))
            xmax = float((payload or {}).get("xmax", max(a, b) + 1.0))
            samples = int((payload or {}).get("samples", 1800))

            if a >= b:
                return {"ok": False, "error": "Interval must satisfy a < b."}
            if xmin >= xmax:
                return {"ok": False, "error": "xmin must be < xmax."}
            if n < 1:
                n = 1
            if sum_type not in {item[0] for item in SUM_TYPES}:
                return {"ok": False, "error": "Unknown sum type."}

            expr = parse_expr(expr_text)
            x_vals = sample_domain(xmin, xmax, samples)
            y_true = safe_eval(expr, x_vals, clip=1.0e9)

            integral_ref = _high_res_integral(expr, a, b)
            abs_f_integral = _integral_abs_f(expr, a, b)
            estimate = _riemann_estimate(expr, a, b, n, sum_type)
            error_value = estimate - integral_ref
            pct, pct_basis = _error_percent(error_value, integral_ref, abs_f_integral)

            return plot_payload(
                x_vals,
                y_true,
                x_range=[xmin, xmax],
                extra={
                    "interval": [a, b],
                    "sumType": sum_type,
                    "n": n,
                    "integralRef": integral_ref,
                    "absFIntegral": abs_f_integral,
                    "estimate": estimate,
                    "error": error_value,
                    "percentError": pct,
                    "percentBasis": pct_basis,
                },
            )
        except Exception as exc:
            return {"ok": False, "error": f"{exc}"}


def main():
    """Launch Riemann visualizer directly (use app.py for the full hub)."""
    launch_app(
        RiemannApi(),
        "ui/riemann/index.html",
        title="Riemann Sum Visualizer",
    )


if __name__ == "__main__":
    main()
