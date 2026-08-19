#!/usr/bin/env python3
"""
Taylor series approximation visualizer (pywebview app).
"""

from __future__ import annotations

import numpy as np
import sympy as sp

from calcbc.graph import (
    compute_function_preview,
    launch_app,
    parse_expr,
    plot_payload,
    render_latex_png,
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
    "log(x)",
    "log(1+x)",
    "sqrt(1+x)",
    "atan(x)",
    "asin(x)",
    "acos(x)",
    "sinh(x)",
    "cosh(x)",
    "tanh(x)",
    "1/(1-x)",
    "x^2 + 2x + 1",
    "pi",
    "E",
]

PRESETS = [
    ("sin(x)", "sin(x)"),
    ("cos(x)", "cos(x)"),
    ("e^x", "e^x"),
    ("ln(1+x)", "ln(1+x)"),
    ("tan(x)", "tan(x)"),
    ("1/(1-x)", "1/(1-x)"),
    ("sqrt(1+x)", "sqrt(1+x)"),
    ("x^2+2x+1", "x^2 + 2x + 1"),
    ("sinh(x)", "sinh(x)"),
    ("arctan(x)", "atan(x)"),
]


def compute_taylor_partials(expr, center, max_degree):
    a = sp.nsimplify(center)
    partial_exprs = []
    nonzero_terms = []
    acc = sp.Integer(0)
    degree = max(0, int(max_degree))
    for k in range(degree + 1):
        deriv_at_a = sp.simplify(sp.diff(expr, x, k).subs(x, a))
        if deriv_at_a == 0:
            continue
        term_expr = sp.simplify(deriv_at_a * (x - a) ** k / sp.factorial(k))
        acc = sp.expand(acc + term_expr)
        partial_exprs.append(acc)
        nonzero_terms.append((k, deriv_at_a))
    if not partial_exprs:
        partial_exprs = [sp.Integer(0)]
        nonzero_terms = [(0, sp.Integer(0))]
    return partial_exprs, nonzero_terms


def _coeff_factor_latex(coeff) -> tuple[str, bool]:
    """Return (coefficient string, needs explicit fraction) for Taylor term latex."""
    c = sp.simplify(coeff)
    if c == 0:
        return "0", False
    if c == 1:
        return "", True
    if c == -1:
        return "-", True
    return sp.latex(c), True


def format_taylor_latex(nonzero_terms, center):
    a = sp.nsimplify(center)
    shift_ltx = "x" if sp.simplify(a) == 0 else rf"\left(x-{sp.latex(a)}\right)"
    latex_parts = []
    for k, coeff in nonzero_terms:
        coeff_ltx, use_frac = _coeff_factor_latex(coeff)
        if k == 0:
            latex_parts.append(coeff_ltx if coeff_ltx not in ("", "-") else sp.latex(coeff))
            continue
        pwr = shift_ltx if k == 1 else rf"{shift_ltx}^{{{k}}}"
        if use_frac:
            if coeff_ltx == "-":
                latex_parts.append(rf"-\frac{{{pwr}}}{{{k}!}}")
            elif coeff_ltx == "":
                latex_parts.append(rf"\frac{{{pwr}}}{{{k}!}}")
            else:
                latex_parts.append(rf"\frac{{{coeff_ltx}\,{pwr}}}{{{k}!}}")
        else:
            latex_parts.append(coeff_ltx)
    latex_body = " + ".join(latex_parts).replace("+ -", "- ")
    max_degree = nonzero_terms[-1][0] if nonzero_terms else 0
    return rf"P_{{{max_degree}}}(x) = {latex_body}"


def _f_scale(expr, xmin: float, xmax: float) -> float:
    x_vals = sample_domain(xmin, xmax, 1200)
    y_true = safe_eval(expr, x_vals)
    y_abs = np.abs(y_true[np.isfinite(y_true)])
    if len(y_abs) == 0:
        return 1.0
    scale = float(np.nanmax(y_abs))
    return scale if scale > 1e-12 else 1.0


def lagrange_bounds_for_partials(
    expr,
    center,
    nonzero_terms,
    bound_xmin,
    bound_xmax,
    partial_exprs,
):
    """
    Lagrange remainder bound on the user-selected window [bound_xmin, bound_xmax]:
    |R_n(x)| <= M * r^(n+1) / (n+1)!, where n is the Taylor polynomial degree.
    Also tracks the sampled max |f - P_n| for a realistic error readout.
    """
    a = float(center)
    lo = float(min(bound_xmin, bound_xmax))
    hi = float(max(bound_xmin, bound_xmax))
    r = max(abs(lo - a), abs(hi - a))
    xs = np.linspace(lo, hi, 4000)
    x_bound = sample_domain(lo, hi, 2000)
    y_true_bound = safe_eval(expr, x_bound)
    scale = _f_scale(expr, lo, hi)
    bounds_pct = []
    empirical_pct = []

    for i in range(len(nonzero_terms)):
        max_degree = nonzero_terms[i][0]
        order = max_degree + 1
        deriv = sp.diff(expr, x, order)
        try:
            f_d = sp.lambdify(x, deriv, modules=["numpy"])
            with np.errstate(
                divide="ignore",
                invalid="ignore",
                over="ignore",
                under="ignore",
            ):
                dvals = np.abs(np.asarray(f_d(xs), dtype=float))
            finite = dvals[np.isfinite(dvals)]
            if finite.size:
                M = float(np.nanmax(finite))
            else:
                M = 0.0
        except Exception:
            M = 0.0
        if not np.isfinite(M):
            M = 0.0

        bound = M * (r**order) / float(sp.factorial(order))
        if not np.isfinite(bound):
            bound = 0.0
        bounds_pct.append((bound / scale) * 100.0 if scale > 0 else 0.0)

        y_partial = safe_eval(partial_exprs[i], x_bound, clip=1.0e9)
        err_vals = np.abs(y_true_bound - y_partial)
        err_finite = err_vals[np.isfinite(err_vals)]
        empirical = float(np.nanmax(err_finite)) if err_finite.size else 0.0
        empirical_pct.append((empirical / scale) * 100.0 if scale > 0 else 0.0)

    return bounds_pct, empirical_pct


class TaylorApi:
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

            center = float((payload or {}).get("center", 0.0))
            max_degree = int((payload or {}).get("terms", 8))
            xmin = float((payload or {}).get("xmin", -4.0))
            xmax = float((payload or {}).get("xmax", 4.0))
            bound_xmin = float((payload or {}).get("boundXmin", xmin))
            bound_xmax = float((payload or {}).get("boundXmax", xmax))
            samples = int((payload or {}).get("samples", 1400))
            if xmin >= xmax:
                return {"ok": False, "error": "xmin must be < xmax."}
            if max_degree < 0:
                max_degree = 0

            expr = parse_expr(expr_text)
            x_vals = sample_domain(xmin, xmax, samples)
            partial_exprs, nonzero_terms = compute_taylor_partials(expr, center, max_degree)

            if not partial_exprs:
                return {
                    "ok": False,
                    "error": "Could not compute a Taylor series for this input.",
                }

            y_true = safe_eval(expr, x_vals)
            y_partials = [to_js_array(safe_eval(pe, x_vals)) for pe in partial_exprs]
            latex_steps = [
                format_taylor_latex(nonzero_terms[: i + 1], center)
                for i in range(len(nonzero_terms))
            ]
            latex_png_steps = [render_latex_png(body) for body in latex_steps]
            error_bound_pct, empirical_error_pct = lagrange_bounds_for_partials(
                expr,
                center,
                nonzero_terms,
                bound_xmin,
                bound_xmax,
                partial_exprs,
            )

            return plot_payload(
                x_vals,
                y_true,
                x_range=[xmin, xmax],
                extra={
                    "partials": y_partials,
                    "latex": latex_steps[-1],
                    "latexPng": latex_png_steps[-1],
                    "latexSteps": latex_steps,
                    "latexPngSteps": latex_png_steps,
                    "errorBoundPct": error_bound_pct,
                    "empiricalErrorPct": empirical_error_pct,
                    "errorWindow": [bound_xmin, bound_xmax],
                    "termCount": len(partial_exprs),
                    "degrees": [int(k) for k, _ in nonzero_terms],
                    "maxDegree": max_degree,
                },
            )
        except Exception as exc:
            return {"ok": False, "error": f"{exc}"}


def main():
    """Launch Taylor visualizer directly (use app.py for the full hub)."""
    launch_app(
        TaylorApi(),
        "ui/taylor/index.html",
        title="Taylor Polynomial Visualizer",
    )


if __name__ == "__main__":
    main()
