#!/usr/bin/env python3
"""
Arc length visualizer backend: polygonal L_n vs ∫ √(1+[f'(x)]²) dx.
"""

from __future__ import annotations

import numpy as np
import sympy as sp

from calcbc.graph import (
    classroom_str,
    compute_function_preview,
    launch_app,
    parse_expr,
    plot_payload,
    safe_eval,
    sample_domain,
    x,
)
from calcbc.latex_formulas import arc_length_latex, render_formula

FUNCTION_HINTS = [
    "sin(x)",
    "cos(x)",
    "e^x",
    "ln(x+2)",
    "x^2",
    "x^3 - x",
    "sqrt(4-x^2)",
    "sqrt(x+1)",
    "1/(1+x^2)",
]

PRESETS = [
    ("x^2", "x^2"),
    ("sin(x)", "sin(x)"),
    ("e^x", "e^x"),
    ("√(4−x²)", "sqrt(4-x^2)"),
    ("ln(x+2)", "ln(x+2)"),
    ("x^3 − x", "x^3 - x"),
]


def _latex_num(v: float) -> str:
    r = float(v)
    if abs(r - round(r)) < 1e-9:
        return str(int(round(r)))
    return f"{r:g}"


def format_arc_length_latex(a: float, b: float, deriv) -> str:
    return arc_length_latex(a, b, deriv)


def _attach_formula_fields(result: dict, payload: dict | None) -> None:
    data = payload or {}
    expr_text = str(data.get("expr") or "").strip()
    if not expr_text:
        return
    a = float(data.get("a", 0.0))
    b = float(data.get("b", 2.0))
    expr = parse_expr(expr_text)
    deriv = sp.diff(expr, x)
    result["derivExpr"] = classroom_str(deriv)
    result["latexPng"] = render_formula(format_arc_length_latex(a, b, deriv), wide=True)


def _eval_for_integral(expr, xs: np.ndarray) -> np.ndarray:
    return safe_eval(expr, xs, clip=None, break_jumps=False)


def _reject_if_singular(xs: np.ndarray, ys: np.ndarray, *, label: str) -> None:
    if xs.size < 8:
        raise ValueError(f"{label} could not be estimated on this interval.")
    interior = ys[1:-1]
    if np.any(~np.isfinite(interior)):
        raise ValueError(
            f"{label} is undefined or unbounded inside (a, b). "
            "Arc length requires a continuous, piecewise-smooth curve."
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
                "Arc length is not defined as a proper integral there."
            )


def _trapezoid_skip_endpoint_nans(xs: np.ndarray, ys: np.ndarray, *, label: str) -> float:
    lo, hi = 0, ys.size - 1
    while lo <= hi and not np.isfinite(ys[lo]):
        lo += 1
    while hi >= lo and not np.isfinite(ys[hi]):
        hi -= 1
    if hi - lo + 1 < 8:
        raise ValueError(f"{label} could not be estimated on this interval.")
    value = float(np.trapezoid(ys[lo : hi + 1], xs[lo : hi + 1]))
    if not np.isfinite(value) or value < 0:
        raise ValueError(f"{label} could not be estimated on this interval.")
    return value


def _high_res_arc_length(expr, a: float, b: float) -> tuple[float, object]:
    deriv = sp.diff(expr, x)
    speed = sp.sqrt(1 + deriv**2)
    # Cluster samples near the endpoints - f′ often blows up there (e.g. a semicircle).
    t = np.linspace(0.0, 1.0, 36000)
    u = 0.5 - 0.5 * np.cos(np.pi * t)
    xs = a + (b - a) * u
    ys = _eval_for_integral(speed, xs)
    _reject_if_singular(xs, ys, label="Arc length integrand")
    return _trapezoid_skip_endpoint_nans(xs, ys, label="Arc length"), deriv


def _polygonal_length(expr, a: float, b: float, n: int) -> float:
    n = max(1, int(n))
    xs = np.linspace(a, b, n + 1)
    ys = _eval_for_integral(expr, xs)
    if np.any(~np.isfinite(ys)):
        raise ValueError("f(x) is undefined at a partition point. Try a different interval.")
    dx = np.diff(xs)
    dy = np.diff(ys)
    return float(np.sum(np.hypot(dx, dy)))


class ArcLengthApi:
    def get_bootstrap(self):
        return {
            "hints": FUNCTION_HINTS,
            "presets": PRESETS,
        }

    def preview(self, payload):
        result = compute_function_preview(payload)
        if result.get("ok"):
            try:
                _attach_formula_fields(result, payload)
            except Exception:
                pass
        return result

    def preview_function(self, payload):
        return self.preview(payload)

    def compute(self, payload):
        try:
            data = payload or {}
            expr_text = str(data.get("expr") or "").strip()
            if not expr_text:
                return {"ok": False, "error": "Please enter a function."}

            a = float(data.get("a", 0.0))
            b = float(data.get("b", 2.0))
            n = int(data.get("n", 8) or 8)
            xmin = float(data.get("xmin", min(a, b) - 1.0))
            xmax = float(data.get("xmax", max(a, b) + 1.0))
            samples = int(data.get("samples", 1800))

            if a >= b:
                return {"ok": False, "error": "Interval must satisfy a < b."}
            if xmin >= xmax:
                return {"ok": False, "error": "xmin must be < xmax."}
            n = max(1, n)

            expr = parse_expr(expr_text)
            extra_syms = expr.free_symbols - {x}
            if extra_syms:
                names = ", ".join(sorted(str(s) for s in extra_syms))
                raise ValueError(f"f(x) can only use x, not {names}.")

            x_vals = sample_domain(xmin, xmax, samples)
            y_true = safe_eval(expr, x_vals, clip=1.0e9)
            length_ref, deriv = _high_res_arc_length(expr, a, b)
            estimate = _polygonal_length(expr, a, b, n)
            error_value = estimate - length_ref
            abs_ref = abs(length_ref)
            pct = 0.0 if abs_ref < 1e-12 else abs(error_value) / abs_ref * 100.0
            latex_body = format_arc_length_latex(a, b, deriv)

            return plot_payload(
                x_vals,
                y_true,
                x_range=[xmin, xmax],
                extra={
                    "interval": [a, b],
                    "n": n,
                    "lengthRef": length_ref,
                    "estimate": estimate,
                    "error": error_value,
                    "percentError": pct,
                    "derivExpr": classroom_str(deriv),
                    "latexPng": render_formula(latex_body, wide=True),
                },
            )
        except Exception as exc:
            return {"ok": False, "error": f"{exc}"}


def main():
    launch_app(
        ArcLengthApi(),
        "ui/arc_length/index.html",
        title="Arc Length Visualizer",
    )


if __name__ == "__main__":
    main()
