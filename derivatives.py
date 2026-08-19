#!/usr/bin/env python3
"""
Derivative visualizer backend (pywebview app).
"""

from __future__ import annotations

import numpy as np
import sympy as sp

from graph import (
    combined_y_range,
    compute_function_preview,
    launch_app,
    parse_expr,
    plot_payload,
    safe_eval,
    sample_domain,
    to_js_array,
    x,
)

FUNCTION_HINTS = [
    "sin(x)",
    "cos(x)",
    "tan(x)",
    "exp(x)",
    "log(x+2)",
    "x**2",
    "x**3",
    "x**4 - 2*x**2",
    "x**3 - 3*x",
    "1/(1+x**2)",
]

PRESETS = [
    ("sin(x)", "sin(x)"),
    ("x^2", "x**2"),
    ("x^3 - 3x", "x**3 - 3*x"),
    ("x^4 - 2x^2", "x**4 - 2*x**2"),
    ("e^x", "exp(x)"),
    ("ln(x+2)", "log(x+2)"),
]


def _safe_symbolic_derivative(expr, order: int):
    return sp.simplify(sp.diff(expr, x, order))


def _concavity_snapshot(second_derivative_vals, x_vals, a: float, b: float):
    mask = (x_vals >= a) & (x_vals <= b)
    if not np.any(mask):
        return "Unknown"
    vals = second_derivative_vals[mask]
    vals = vals[np.isfinite(vals)]
    if vals.size == 0:
        return "Unknown"
    eps = 1e-7
    pos = np.count_nonzero(vals > eps)
    neg = np.count_nonzero(vals < -eps)
    total = max(pos + neg, 1)
    if pos / total > 0.8:
        return "Concave Up"
    if neg / total > 0.8:
        return "Concave Down"
    return "Changes Concavity"


class DerivativesApi:
    def get_bootstrap(self):
        return {
            "hints": FUNCTION_HINTS,
            "presets": PRESETS,
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

            a = float((payload or {}).get("a", -2.0))
            b = float((payload or {}).get("b", 2.0))
            xmin = float((payload or {}).get("xmin", min(a, b) - 2.0))
            xmax = float((payload or {}).get("xmax", max(a, b) + 2.0))
            samples = int((payload or {}).get("samples", 1800))
            include_second = bool((payload or {}).get("includeSecond", True))

            if a >= b:
                return {"ok": False, "error": "Interval must satisfy a < b."}
            if xmin >= xmax:
                return {"ok": False, "error": "xmin must be < xmax."}

            expr = parse_expr(expr_text)
            first_derivative = _safe_symbolic_derivative(expr, 1)
            second_derivative = _safe_symbolic_derivative(expr, 2)

            x_vals = sample_domain(xmin, xmax, samples)
            y_true = safe_eval(expr, x_vals, clip=1.0e9)
            y_first = safe_eval(first_derivative, x_vals, clip=1.0e9)
            y_second = safe_eval(second_derivative, x_vals, clip=1.0e9) if include_second else None

            concavity_label = (
                _concavity_snapshot(y_second, x_vals, a, b) if include_second else "Second derivative hidden"
            )

            y_range = combined_y_range(
                y_true,
                y_first,
                y_second if include_second else None,
            )

            return plot_payload(
                x_vals,
                y_true,
                x_range=[xmin, xmax],
                y_range=y_range,
                extra={
                    "interval": [a, b],
                    "firstDerivative": to_js_array(y_first),
                    "secondDerivative": to_js_array(y_second) if y_second is not None else None,
                    "firstDerivativeExpr": str(first_derivative),
                    "secondDerivativeExpr": str(second_derivative),
                    "concavityInterval": concavity_label,
                    "includeSecond": include_second,
                },
            )
        except Exception as exc:
            return {"ok": False, "error": f"{exc}"}


def main():
    """Launch derivative visualizer directly (use app.py for the full hub)."""
    launch_app(
        DerivativesApi(),
        "ui/derivatives/index.html",
        title="Derivative Visualizer",
    )


if __name__ == "__main__":
    main()
