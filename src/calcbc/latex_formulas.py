#!/usr/bin/env python3
"""LaTeX formula builders and PNG render helpers for visualizer headers."""

from __future__ import annotations

import sympy as sp

from calcbc.graph import render_latex_png, x

t = sp.symbols("t")
theta = sp.symbols("theta")


def latex_num(v: float) -> str:
    r = float(v)
    if abs(r - round(r)) < 1e-9:
        return str(int(round(r)))
    return f"{r:g}"


def latex_endpoint(v: float) -> str:
    return latex_num(v)


def render_formula(latex_body: str, *, color: str = "#f5c842", wide: bool = False) -> str:
    figsize = (18.0, 0.9) if wide else (14.0, 0.85)
    return render_latex_png(latex_body, color=color, figsize=figsize)


def arc_length_latex(a: float, b: float, deriv) -> str:
    a_ltx = latex_endpoint(a)
    b_ltx = latex_endpoint(b)
    deriv_ltx = sp.latex(deriv)
    return (
        rf"L = \int_{{{a_ltx}}}^{{{b_ltx}}} \sqrt{{1 + \left({deriv_ltx}\right)^2}}\, dx"
        rf" \cdot L_n = \sum \sqrt{{\left(\Delta x\right)^2 + \left(\Delta y\right)^2}}"
    )


def volume_formulas_latex(a: float, b: float, axis: str) -> str:
    a_ltx = latex_endpoint(a)
    b_ltx = latex_endpoint(b)
    area = rf"A = \int_{{{a_ltx}}}^{{{b_ltx}}} \left|f(x)\right|\, dx"
    if axis == "x":
        volume = rf"V = \pi \int_{{{a_ltx}}}^{{{b_ltx}}} \left(f(x)\right)^2\, dx"
    else:
        volume = rf"V = 2\pi \int_{{{a_ltx}}}^{{{b_ltx}}} \left|x\right|\left|f(x)\right|\, dx"
    return rf"{area} \qquad {volume}"


def polar_area_latex(alpha: float, beta: float, *, compare: bool = False) -> str:
    a_ltx = latex_endpoint(alpha)
    b_ltx = latex_endpoint(beta)
    if compare:
        return rf"A = \frac{{1}}{{2}}\int_{{{a_ltx}}}^{{{b_ltx}}} \left(r_{{\mathrm{{outer}}}}^2 - r_{{\mathrm{{inner}}}}^2\right)\, d\theta"
    return rf"A = \frac{{1}}{{2}}\int_{{{a_ltx}}}^{{{b_ltx}}} r^2\, d\theta"


def parametric_curve_latex(x_expr, y_expr, dx_expr, dy_expr) -> str:
    return (
        rf"x(t) = {sp.latex(x_expr)},\quad y(t) = {sp.latex(y_expr)},\quad "
        rf"x'(t) = {sp.latex(dx_expr)},\quad y'(t) = {sp.latex(dy_expr)}"
    )


def parametric_rule_latex(phase: str) -> str:
    rules = {
        "curve": r"(x(t),\ y(t)\ \text{parametric curve})",
        "velocity": r"\vec{v}(t) = \left\langle x'(t),\ y'(t) \right\rangle",
        "slope": r"\frac{dy}{dx} = \frac{y'(t)}{x'(t)}",
        "speed": (
            r"\| \vec{v}(t) \| = \sqrt{\left(x'(t)\right)^2 + \left(y'(t)\right)^2},"
            r"\quad L = \int \| \vec{v}(t) \|\, dt"
        ),
    }
    return rules.get(phase, rules["slope"])


def inverse_formulas_latex(deriv_expr) -> str:
    deriv_ltx = sp.latex(deriv_expr)
    rule = r"\left(f^{-1}\right)'(x) = \frac{1}{f'\!\left(f^{-1}(x)\right)}"
    return rf"{rule} \qquad f'(x) = {deriv_ltx}"


def euler_step_latex() -> str:
    return r"y_{n+1} = y_n + h\, f(x_n, y_n)"


def slope_de_latex(expr_sympy) -> str:
    return rf"y' = {sp.latex(expr_sympy)}"


def limit_formal_latex() -> str:
    return (
        r"\forall \varepsilon > 0\ \exists \delta > 0:\ "
        r"0 < |x-a| < \delta \Rightarrow |f(x)-L| < \varepsilon"
    )


def limit_readout_latex(limit_val: float, epsilon: float, delta: float) -> str:
    return (
        rf"L = {latex_num(limit_val)} \qquad |f(x)-L| < {latex_num(epsilon)} \qquad "
        rf"0 < |x-a| < {latex_num(delta)}"
    )


def derivative_symbols_latex(expr, first_deriv, second_deriv) -> str:
    return (
        rf"f(x) = {sp.latex(expr)} \qquad f'(x) = {sp.latex(first_deriv)} \qquad "
        rf"f''(x) = {sp.latex(second_deriv)}"
    )


def riemann_integral_latex(a: float, b: float) -> str:
    a_ltx = latex_endpoint(a)
    b_ltx = latex_endpoint(b)
    return rf"\int_{{{a_ltx}}}^{{{b_ltx}}} f(x)\, dx \approx \sum f(x_i)\,\Delta x"


def monte_carlo_latex_simple() -> str:
    return r"A \approx \dfrac{N_{\mathrm{in}}}{N}\, A_{\mathrm{box}}"


def monte_carlo_latex_box(a: float, b: float) -> str:
    a_ltx = latex_endpoint(a)
    b_ltx = latex_endpoint(b)
    return (
        rf"A_{{\mathrm{{box}}}} = (b-a)\, y_{{\max}}"
        rf" = ({b_ltx}-{a_ltx})\, y_{{\max}}"
    )


def monte_carlo_latex(a: float, b: float) -> str:
    """Full formula used after setup / for bootstrap."""
    return (
        rf"{monte_carlo_latex_simple()}"
        rf" \qquad {monte_carlo_latex_box(a, b)}"
    )


def fourier_reconstruction_latex() -> str:
    return r"z(t) = \sum_k c_k e^{ikt}, \qquad c_k = \frac{Z[k]}{N}"


def slope_field_header_latex(expr_sympy) -> str:
    return rf"{euler_step_latex()} \qquad {slope_de_latex(expr_sympy)}"
