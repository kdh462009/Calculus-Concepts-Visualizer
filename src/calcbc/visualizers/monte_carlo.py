#!/usr/bin/env python3
"""
Monte Carlo integration visualizer backend.

Python prepares the mathematical sampling envelope only:
  parse f, sample the curve, bounds, ymax box, reference integral.

JavaScript owns the experiment:
  seeded PRNG, (x, y) generation, classification against the curve,
  animation, counters, and convergence rendering.
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
)
from calcbc.latex_formulas import (
    monte_carlo_latex,
    monte_carlo_latex_box,
    monte_carlo_latex_simple,
    render_formula,
)

FUNCTION_HINTS = [
    "sin(x)",
    "x^2",
    "e^(-x^2)",
    "1/(1+x^2)",
    "sqrt(x)",
    "cos(x)+1.2",
    "x*(2-x)",
]

PRESETS = [
    ("sin(x)", "sin(x)", 0.0, 3.141592653589793),
    ("x²", "x^2", 0.0, 2.0),
    ("bell", "e^(-x^2)", -1.5, 1.5),
    ("1/(1+x²)", "1/(1+x^2)", 0.0, 4.0),
    ("√x", "sqrt(x)", 0.0, 4.0),
    ("hump", "x*(2-x)", 0.0, 2.0),
]

N_MIN = 100
N_MAX = 50000
N_DEFAULT = 10000
CURVE_SAMPLES = 2400
BOX_PAD = 0.035  # tight enough that under-curve density reads clearly


def _eval_for_integral(expr, xs: np.ndarray) -> np.ndarray:
    return safe_eval(expr, xs, clip=None, break_jumps=False)


def _reject_if_singular(xs: np.ndarray, ys: np.ndarray) -> None:
    if xs.size < 8:
        raise ValueError("Integral could not be estimated on this interval.")
    interior = ys[1:-1]
    if np.any(~np.isfinite(interior)):
        raise ValueError(
            "f is undefined or unbounded inside (a, b). "
            "Pick a closed interval where f stays finite."
        )
    finite = ys[np.isfinite(ys)]
    if finite.size < max(10, xs.size // 3):
        raise ValueError("Integral could not be estimated on this interval.")


def _high_res_integral(expr, a: float, b: float) -> float:
    xs = np.linspace(a, b, 24000)
    ys = _eval_for_integral(expr, xs)
    _reject_if_singular(xs, ys)
    lo, hi = 0, ys.size - 1
    while lo <= hi and not np.isfinite(ys[lo]):
        lo += 1
    while hi >= lo and not np.isfinite(ys[hi]):
        hi -= 1
    if hi - lo + 1 < 8:
        raise ValueError("Integral could not be estimated on this interval.")
    value = float(np.trapezoid(ys[lo : hi + 1], xs[lo : hi + 1]))
    if not np.isfinite(value):
        raise ValueError("Integral could not be estimated on this interval.")
    return value


def _require_nonnegative(ys: np.ndarray) -> None:
    finite = ys[np.isfinite(ys)]
    if finite.size == 0:
        raise ValueError("f has no finite values on [a, b].")
    floor = float(np.min(finite))
    if floor < -1e-6:
        raise ValueError(
            "This visualizer currently estimates area for f(x) ≥ 0 on [a, b]. "
            "Try a nonnegative function (or shift it upward)."
        )


def _bounding_box(a: float, b: float, curve_y: np.ndarray) -> dict:
    """Math sampling envelope: height is exactly y_max (matches A_box formula)."""
    finite = curve_y[np.isfinite(curve_y)]
    y_hi = float(np.max(finite)) if finite.size else 1.0
    if y_hi < 1e-9:
        y_hi = 1.0
    return {
        "x0": float(a),
        "x1": float(b),
        "y0": 0.0,
        "y1": float(y_hi),  # == yMax; used for sampling + boxArea
        "yMax": float(y_hi),
    }


class MonteCarloApi:
    def get_bootstrap(self):
        return {
            "hints": FUNCTION_HINTS,
            "presets": PRESETS,
            "nMin": N_MIN,
            "nMax": N_MAX,
            "nDefault": N_DEFAULT,
            "latexPng": render_formula(monte_carlo_latex_simple(), wide=True),
        }

    def _attach_formula(self, result: dict, a: float, b: float) -> None:
        result["latexPng"] = render_formula(monte_carlo_latex_simple(), wide=True)
        result["latexPngBox"] = render_formula(monte_carlo_latex_box(a, b), wide=True)
        result["latexPngFull"] = render_formula(monte_carlo_latex(a, b), wide=True)

    def preview(self, payload):
        data = dict(payload or {})
        # Same framing rule as compute: plot window must cover [a, b].
        try:
            a = float(data.get("a", 0.0))
            b = float(data.get("b", np.pi))
            if a < b:
                span = b - a
                pad = max(span * 0.1, 0.5)
                try:
                    xmin_in = float(data.get("xmin", a - pad))
                    xmax_in = float(data.get("xmax", b + pad))
                except (TypeError, ValueError):
                    xmin_in, xmax_in = a - pad, b + pad
                covers = (
                    np.isfinite(xmin_in)
                    and np.isfinite(xmax_in)
                    and xmin_in < xmax_in
                    and xmin_in <= a - pad * 0.25
                    and xmax_in >= b + pad * 0.25
                )
                if covers:
                    data["xmin"], data["xmax"] = xmin_in, xmax_in
                else:
                    data["xmin"], data["xmax"] = a - pad, b + pad
        except Exception:
            pass
        result = compute_function_preview(data)
        if not result.get("ok"):
            return result
        try:
            a = float(data.get("a", 0.0))
            b = float(data.get("b", np.pi))
            if a < b:
                self._attach_formula(result, a, b)
        except Exception:
            pass
        return result

    def compute(self, payload):
        """Return curve + sampling box + reference. No random samples."""
        try:
            data = payload or {}
            expr_text = str(data.get("expr") or "").strip()
            if not expr_text:
                return {"ok": False, "error": "Please enter a function."}

            a = float(data.get("a", 0.0))
            b = float(data.get("b", np.pi))
            n = int(data.get("n", N_DEFAULT) or N_DEFAULT)
            n = int(np.clip(n, N_MIN, N_MAX))

            if a >= b:
                return {"ok": False, "error": "Interval must satisfy a < b."}

            # Always frame the plot around [a, b]. Stale xmin/xmax (e.g. left on a
            # previous preset) would leave the sampling box off-screen while y zooms
            # to y_max on [a, b] — an empty / broken view.
            span = b - a
            pad = max(span * 0.1, 0.5)
            try:
                xmin_in = float(data.get("xmin", a - pad))
                xmax_in = float(data.get("xmax", b + pad))
            except (TypeError, ValueError):
                xmin_in, xmax_in = a - pad, b + pad
            covers = (
                np.isfinite(xmin_in)
                and np.isfinite(xmax_in)
                and xmin_in < xmax_in
                and xmin_in <= a - pad * 0.25
                and xmax_in >= b + pad * 0.25
            )
            if covers:
                xmin, xmax = xmin_in, xmax_in
            else:
                xmin, xmax = a - pad, b + pad

            expr = parse_expr(expr_text)
            # Dense curve on [a, b] so JS can interpolate f(x) while classifying.
            curve_x = np.linspace(a, b, CURVE_SAMPLES)
            curve_y = _eval_for_integral(expr, curve_x)
            _reject_if_singular(curve_x, curve_y)
            _require_nonnegative(curve_y)

            box = _bounding_box(a, b, curve_y)
            integral_ref = _high_res_integral(expr, a, b)

            x_vals = sample_domain(xmin, xmax, 1800)
            y_true = safe_eval(expr, x_vals, clip=1.0e9)
            # Plot framing only: a little air around the math box (not part of A_box).
            y_pad = max(box["yMax"] * BOX_PAD, 0.04)
            y_lo = box["y0"] - y_pad * 0.35
            y_hi = box["y1"] + y_pad

            return plot_payload(
                x_vals,
                y_true,
                x_range=[xmin, xmax],
                y_range=[y_lo, y_hi],
                extra={
                    "expr": expr_text,
                    "interval": [a, b],
                    "box": box,
                    "boxArea": float((box["x1"] - box["x0"]) * box["yMax"]),
                    "curveX": [float(v) for v in curve_x],
                    "curveY": [
                        None if not np.isfinite(v) else float(v) for v in curve_y
                    ],
                    "integralRef": integral_ref,
                    "n": n,
                    "latexPng": render_formula(monte_carlo_latex_simple(), wide=True),
                    "latexPngBox": render_formula(monte_carlo_latex_box(a, b), wide=True),
                    "latexPngFull": render_formula(monte_carlo_latex(a, b), wide=True),
                },
            )
        except Exception as exc:
            return {"ok": False, "error": f"{exc}"}


def main():
    launch_app(
        MonteCarloApi(),
        "ui/monte_carlo/index.html",
        title="Monte Carlo Integration",
    )


if __name__ == "__main__":
    main()
