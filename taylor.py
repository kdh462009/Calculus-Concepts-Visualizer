#!/usr/bin/env python3
"""
Taylor series approximation visualizer (pywebview app).
"""

from __future__ import annotations

import numpy as np
import sympy as sp

from graph import (
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
    "x**2 + 2*x + 1",
    "pi",
    "E",
]

PRESETS = [
    ("sin(x)", "sin(x)"),
    ("cos(x)", "cos(x)"),
    ("e^x", "exp(x)"),
    ("ln(1+x)", "log(1+x)"),
    ("tan(x)", "tan(x)"),
    ("1/(1-x)", "1/(1-x)"),
    ("sqrt(1+x)", "sqrt(1+x)"),
    ("x^2+2x+1", "x**2 + 2*x + 1"),
    ("sinh(x)", "sinh(x)"),
    ("arctan(x)", "atan(x)"),
]


def compute_taylor_partials(expr, center, n_terms):
    a = sp.nsimplify(center)
    partial_exprs = []
    nonzero_terms = []
    acc = sp.Integer(0)
    max_degree_scan = max(30, n_terms * 8)
    for k in range(max_degree_scan):
        deriv_at_a = sp.simplify(sp.diff(expr, x, k).subs(x, a))
        if deriv_at_a == 0:
            continue
        term_expr = sp.simplify(deriv_at_a * (x - a) ** k / sp.factorial(k))
        acc = sp.expand(acc + term_expr)
        partial_exprs.append(acc)
        nonzero_terms.append((k, deriv_at_a))
        if len(partial_exprs) >= n_terms:
            break
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


def lagrange_bounds_for_partials(expr, center, nonzero_terms, xmin, xmax):
    """
    Lagrange remainder bound on [xmin, xmax]:
    |R_n(x)| <= M * r^(n+1) / (n+1)!,  n = polynomial degree.
    Returns percent of max|f| on the window for each partial step.
    """
    a = float(center)
    r = max(abs(xmin - a), abs(xmax - a))
    xs = np.linspace(min(xmin, xmax), max(xmin, xmax), 4000)
    scale = _f_scale(expr, xmin, xmax)
    bounds_pct = []

    for i in range(len(nonzero_terms)):
        max_degree = nonzero_terms[i][0]
        order = max_degree + 1
        deriv = sp.diff(expr, x, order)
        try:
            f_d = sp.lambdify(x, deriv, modules=["numpy"])
            dvals = np.abs(np.asarray(f_d(xs), dtype=float))
            M = float(np.nanmax(dvals[np.isfinite(dvals)])) if np.any(np.isfinite(dvals)) else 0.0
        except Exception:
            M = 0.0
        if not np.isfinite(M):
            M = 0.0
        bound = M * (r**order) / float(sp.factorial(order))
        bounds_pct.append((bound / scale) * 100.0)

    return bounds_pct


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
            n_terms = int((payload or {}).get("terms", 8))
            xmin = float((payload or {}).get("xmin", -4.0))
            xmax = float((payload or {}).get("xmax", 4.0))
            samples = int((payload or {}).get("samples", 1400))
            if xmin >= xmax:
                return {"ok": False, "error": "xmin must be < xmax."}
            if n_terms < 1:
                n_terms = 1

            expr = parse_expr(expr_text)
            x_vals = sample_domain(xmin, xmax, samples)
            partial_exprs, nonzero_terms = compute_taylor_partials(expr, center, n_terms)

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
            error_bound_pct = lagrange_bounds_for_partials(
                expr, center, nonzero_terms, xmin, xmax
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
                    "termCount": len(partial_exprs),
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
