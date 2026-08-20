#!/usr/bin/env python3
"""Live metric readouts rendered as LaTeX PNGs for visualizer headers."""

from __future__ import annotations

from calcbc.latex_formulas import latex_num, render_formula
from calcbc.visualizers.riemann import _error_percent

READOUT_COLOR = "#7df0cd"


def _render(body: str) -> str:
    return render_formula(body, color=READOUT_COLOR, wide=True)


def _verdict_latex(err: float, pct: float) -> str:
    if abs(err) < 1e-12:
        return r"\text{Exact}"
    label = "over" if err > 0 else "under"
    return rf"\text{{{label.title()} by }} \approx {latex_num(pct)}\%"


def arc_length_readout(length_ref: float, estimate: float, n: int) -> str:
    err = estimate - length_ref
    abs_err = abs(err)
    abs_l = abs(length_ref)
    if abs_err < 1e-12:
        err_part = r"\text{Exact}"
    else:
        pct = (abs_err / abs_l * 100.0) if abs_l > 1e-9 else abs_err * 100.0
        err_part = _verdict_latex(err, pct)
    n_ltx = latex_num(float(n))
    return (
        rf"L \approx {latex_num(length_ref)} \qquad "
        rf"L_{{{n_ltx}}} \approx {latex_num(estimate)} \qquad {err_part}"
    )


def riemann_readout(integral: float, estimate: float, sum_type: str, n: int, abs_f_integral: float) -> str:
    err = estimate - integral
    pct, basis = _error_percent(err, integral, abs_f_integral)
    if basis == "exact":
        err_part = r"\text{Exact}"
    else:
        verdict = "over-estimate" if err > 0 else "under-estimate" if err < 0 else "Exact"
        if basis == "area":
            err_part = rf"\text{{{verdict} by }} \approx {latex_num(pct)}\% \text{{ of }} \int |f|\, dx"
        elif basis == "sum":
            err_part = rf"\text{{{verdict} by }} \approx {latex_num(pct)}\% \text{{ (integral }} \approx 0\text{{)}}"
        else:
            err_part = rf"\text{{{verdict} by }} \approx {latex_num(pct)}\%"
    sum_name = str(sum_type or "Riemann").replace("_", " ")
    return (
        rf"\int f(x)\, dx \approx {latex_num(integral)} \qquad "
        rf"\text{{{sum_name}}} (n={latex_num(float(n))}) \approx {latex_num(estimate)} \qquad {err_part}"
    )


def polar_readout(exact: float, estimate: float, n: int, k: int | None, *, phase: str = "full") -> str:
    if phase == "curve" or (k is not None and k <= 0):
        return (
            rf"A \approx {latex_num(exact)} \qquad "
            rf"\text{{sector estimate: }} 0 \text{{ (0/{latex_num(float(n))})}}"
        )
    if k is not None and k < n:
        err_label = _polar_error_label(exact, estimate)
        return (
            rf"A \approx {latex_num(exact)} \qquad "
            rf"\text{{estimate ({latex_num(float(k))}/{latex_num(float(n))} slices): }} "
            rf"{latex_num(estimate)} \qquad {err_label}"
        )
    err_label = _polar_error_label(exact, estimate)
    return (
        rf"A \approx {latex_num(exact)} \qquad "
        rf"\text{{estimate (}} n={latex_num(float(n))}\text{{): }} "
        rf"{latex_num(estimate)} \qquad {err_label}"
    )


def _polar_error_label(exact: float, estimate: float) -> str:
    if not (abs(exact) < float("inf") and abs(estimate) < float("inf")):
        return r"\text{error}"
    abs_err = abs(estimate - exact)
    if abs_err < 5e-7:
        return r"\text{error } 0\%"
    pct = (abs_err / abs(exact) * 100.0) if abs(exact) > 1e-12 else abs_err * 100.0
    pct_text = f"{pct:.2f}" if pct >= 0.01 else f"{pct:.4f}"
    return rf"\text{{error }} {pct_text}\% \text{{ (}}\Delta={latex_num(abs_err)}\text{{)}}"


def limit_band_readout(limit_val: float, epsilon: float, delta: float) -> str:
    return (
        rf"L = {latex_num(limit_val)} \qquad |f(x)-L| < {latex_num(epsilon)} \qquad "
        rf"0 < |x-a| < {latex_num(delta)}"
    )


def derivative_point_readout(x: float, fx: float, fpx: float, fppx: float | None = None) -> str:
    parts = [
        rf"x = {latex_num(x)}",
        rf"f(x) = {latex_num(fx)}",
        rf"f'(x) = {latex_num(fpx)}",
    ]
    if fppx is not None:
        parts.append(rf"f''(x) = {latex_num(fppx)}")
    return r" \qquad ".join(parts)


def volume_values_readout(area: float, volume: float, axis: str) -> str:
    axis_label = "y" if str(axis).lower() == "y" else "x"
    return (
        rf"A \approx {latex_num(area)} \qquad "
        rf"V \approx {latex_num(volume)} \text{{ ({axis_label}-axis)}}"
    )


def parametric_arc_readout(length: float) -> str:
    return rf"L \approx {latex_num(length)}"


def _format_error_window(window: str, window_range: list | None) -> str:
    if isinstance(window_range, (list, tuple)) and len(window_range) == 2:
        return rf"x \in [{latex_num(float(window_range[0]))}, {latex_num(float(window_range[1]))}]"
    label = str(window or "plot window").strip()
    if label.startswith("x") and "\\in" in label:
        return label
    return rf"\text{{{label}}}"


def taylor_error_readout(
    bound_pct: float,
    observed_pct: float | None,
    window: str,
    window_range: list | None = None,
) -> str:
    window_ltx = _format_error_window(window, window_range)
    body = (
        rf"\text{{Lagrange bound }} \lesssim {latex_num(bound_pct)}\% "
        rf"\text{{ of max }} |f(x)| \text{{ on }} {window_ltx}"
    )
    if observed_pct is not None:
        body += rf" \qquad \text{{observed }} \approx {latex_num(observed_pct)}\%"
    return body


def build_readout(payload: dict) -> str:
    data = payload or {}
    kind = str(data.get("kind") or "").strip()
    if kind == "arc_length":
        return arc_length_readout(
            float(data["lengthRef"]),
            float(data["estimate"]),
            int(data["n"]),
        )
    if kind == "riemann":
        return riemann_readout(
            float(data["integral"]),
            float(data["estimate"]),
            str(data.get("sumType", "left")),
            int(data["n"]),
            float(data.get("absFIntegral", 0.0)),
        )
    if kind == "polar":
        phase = str(data.get("phase", "full"))
        k = data.get("k")
        return polar_readout(
            float(data["exact"]),
            float(data["estimate"]),
            int(data["n"]),
            int(k) if k is not None else None,
            phase=phase,
        )
    if kind == "limit_band":
        return limit_band_readout(
            float(data["limit"]),
            float(data["epsilon"]),
            float(data["delta"]),
        )
    if kind == "derivative_point":
        fppx = data.get("fppx")
        return derivative_point_readout(
            float(data["x"]),
            float(data["fx"]),
            float(data["fpx"]),
            float(fppx) if fppx is not None else None,
        )
    if kind == "volume":
        return volume_values_readout(
            float(data["area"]),
            float(data["volume"]),
            str(data.get("axis", "x")),
        )
    if kind == "taylor_error":
        observed = data.get("observedPct")
        window_range = data.get("windowRange")
        return taylor_error_readout(
            float(data["boundPct"]),
            float(observed) if observed is not None else None,
            str(data.get("window", "plot window")),
            list(window_range) if isinstance(window_range, (list, tuple)) else None,
        )
    if kind == "parametric_arc":
        return parametric_arc_readout(float(data["length"]))
    raise ValueError(f"Unknown readout kind: {kind!r}")


def render_readout(payload: dict | None) -> dict:
    try:
        body = build_readout(payload)
        return {"ok": True, "latexPng": _render(body)}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}
