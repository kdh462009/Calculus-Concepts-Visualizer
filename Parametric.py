#!/usr/bin/env python3
"""
Parametric visualizer backend — AP Calc BC Unit 9 concepts.
"""

from __future__ import annotations

import numpy as np
import sympy as sp

from graph import launch_app, sample_domain, to_js_array

t = sp.symbols("t")

PARSE_LOCALS = {
    "t": t,
    "sin": sp.sin,
    "cos": sp.cos,
    "tan": sp.tan,
    "exp": sp.exp,
    "e": sp.E,
    "E": sp.E,
    "log": sp.log,
    "ln": sp.log,
    "sqrt": sp.sqrt,
    "pi": sp.pi,
    "sinh": sp.sinh,
    "cosh": sp.cosh,
    "tanh": sp.tanh,
    "asin": sp.asin,
    "acos": sp.acos,
    "atan": sp.atan,
    "arctan": sp.atan,
    "abs": sp.Abs,
}

FUNCTION_HINTS = [
    "cos(t), sin(t)",
    "t - sin(t), 1 - cos(t)",
    "sin(3*t), sin(4*t)",
    "t*cos(t), t*sin(t)",
    "e^t*cos(t), e^t*sin(t)",
]

PRESETS = [
    ("Circle", "cos(t)", "sin(t)"),
    ("Cycloid", "t - sin(t)", "1 - cos(t)"),
    ("Lissajous", "sin(3*t)", "sin(4*t)"),
    ("Spiral", "t*cos(t)", "t*sin(t)"),
    ("Log spiral", "exp(0.15*t)*cos(t)", "exp(0.15*t)*sin(t)"),
]


def parse_param_expr(text: str):
    return sp.sympify(text, locals=PARSE_LOCALS)


def safe_eval_t(expr, t_vals, clip=1.0e9):
    try:
        f = sp.lambdify(t, expr, modules=["numpy"])
        with np.errstate(divide="ignore", invalid="ignore", over="ignore", under="ignore"):
            y = np.asarray(f(t_vals), dtype=float)
        if y.ndim == 0:
            y = np.full_like(t_vals, float(y), dtype=float)
        y = np.where(np.isfinite(y), y, np.nan)
        return np.clip(y, -clip, clip)
    except Exception:
        return np.full_like(t_vals, np.nan, dtype=float)


def _xy_range(x_vals: np.ndarray, y_vals: np.ndarray) -> tuple[list[float], list[float]]:
    valid = np.isfinite(x_vals) & np.isfinite(y_vals)
    if np.count_nonzero(valid) < 8:
        raise ValueError("Not enough valid points to plot this curve.")
    xv = x_vals[valid]
    yv = y_vals[valid]
    xmin, xmax = float(np.min(xv)), float(np.max(xv))
    ymin, ymax = float(np.min(yv)), float(np.max(yv))
    xpad = max((xmax - xmin) * 0.14, 0.8)
    ypad = max((ymax - ymin) * 0.14, 0.8)
    return [xmin - xpad, xmax + xpad], [ymin - ypad, ymax + ypad]


def _unit_vectors(dx: np.ndarray, dy: np.ndarray):
    speed = np.sqrt(dx * dx + dy * dy)
    with np.errstate(divide="ignore", invalid="ignore"):
        ux = np.where(speed > 1e-12, dx / speed, np.nan)
        uy = np.where(speed > 1e-12, dy / speed, np.nan)
    return ux, uy, speed


def _arc_length(speed: np.ndarray, t_vals: np.ndarray) -> float:
    valid = np.isfinite(speed)
    if np.count_nonzero(valid) < 8:
        return float("nan")
    return float(np.trapezoid(speed[valid], t_vals[valid]))


def _tangent_segments(x_vals, y_vals, dydx, t_vals, count=14, half_len=0.55):
    valid = np.isfinite(x_vals) & np.isfinite(y_vals) & np.isfinite(dydx)
    idxs = np.linspace(0, len(t_vals) - 1, count, dtype=int)
    segments = []
    for i in idxs:
        if not valid[i]:
            continue
        x0 = float(x_vals[i])
        y0 = float(y_vals[i])
        m = float(dydx[i])
        segments.append(
            {
                "t": float(t_vals[i]),
                "x0": x0,
                "y0": y0,
                "x1": x0 - half_len,
                "y1": y0 - m * half_len,
                "x2": x0 + half_len,
                "y2": y0 + m * half_len,
            }
        )
    return segments


def _sample_vectors(x_vals, y_vals, dx, dy, t_vals, count=12, scale=0.55):
    idxs = np.linspace(0, len(t_vals) - 1, count, dtype=int)
    vectors = []
    for i in idxs:
        if not (np.isfinite(x_vals[i]) and np.isfinite(y_vals[i]) and np.isfinite(dx[i]) and np.isfinite(dy[i])):
            continue
        vectors.append(
            {
                "t": float(t_vals[i]),
                "x": float(x_vals[i]),
                "y": float(y_vals[i]),
                "dx": float(dx[i]) * scale,
                "dy": float(dy[i]) * scale,
            }
        )
    return vectors


class ParametricApi:
    def get_bootstrap(self):
        return {
            "hints": FUNCTION_HINTS,
            "presets": PRESETS,
            "concepts": [
                ("curve", "Parametric curve (x(t), y(t))"),
                ("velocity", "Velocity vector ⟨x′(t), y′(t)⟩"),
                ("slope", "Tangent slope dy/dx = y′(t)/x′(t)"),
                ("speed", "Speed ‖v‖ and arc length"),
            ],
        }

    def compute(self, payload):
        try:
            x_expr_text = (payload or {}).get("xExpr", "").strip()
            y_expr_text = (payload or {}).get("yExpr", "").strip()
            if not x_expr_text or not y_expr_text:
                return {"ok": False, "error": "Please enter x(t) and y(t)."}

            tmin = float((payload or {}).get("tmin", 0.0))
            tmax = float((payload or {}).get("tmax", float(2 * np.pi)))
            samples = int((payload or {}).get("samples", 1800))
            if tmin >= tmax:
                return {"ok": False, "error": "tmin must be < tmax."}

            x_expr = parse_param_expr(x_expr_text)
            y_expr = parse_param_expr(y_expr_text)

            dx_expr = sp.simplify(sp.diff(x_expr, t))
            dy_expr = sp.simplify(sp.diff(y_expr, t))
            d2x_expr = sp.simplify(sp.diff(x_expr, t, 2))
            d2y_expr = sp.simplify(sp.diff(y_expr, t, 2))

            t_vals = sample_domain(tmin, tmax, samples)
            x_vals = safe_eval_t(x_expr, t_vals)
            y_vals = safe_eval_t(y_expr, t_vals)
            dx_vals = safe_eval_t(dx_expr, t_vals)
            dy_vals = safe_eval_t(dy_expr, t_vals)
            d2x_vals = safe_eval_t(d2x_expr, t_vals)
            d2y_vals = safe_eval_t(d2y_expr, t_vals)

            with np.errstate(divide="ignore", invalid="ignore"):
                dydx = np.where(np.abs(dx_vals) > 1e-12, dy_vals / dx_vals, np.nan)
                d2ydx2 = np.where(
                    np.abs(dx_vals) > 1e-12,
                    (d2y_vals * dx_vals - dy_vals * d2x_vals) / (dx_vals ** 3),
                    np.nan,
                )

            ux, uy, speed = _unit_vectors(dx_vals, dy_vals)
            arc_len = _arc_length(speed, t_vals)
            x_range, y_range = _xy_range(x_vals, y_vals)

            return {
                "ok": True,
                "t": to_js_array(t_vals),
                "xCurve": to_js_array(x_vals),
                "yCurve": to_js_array(y_vals),
                "dxdt": to_js_array(dx_vals),
                "dydt": to_js_array(dy_vals),
                "dydx": to_js_array(dydx),
                "d2ydx2": to_js_array(d2ydx2),
                "speed": to_js_array(speed),
                "unitTangentX": to_js_array(ux),
                "unitTangentY": to_js_array(uy),
                "xExpr": str(x_expr),
                "yExpr": str(y_expr),
                "dxExpr": str(dx_expr),
                "dyExpr": str(dy_expr),
                "d2xExpr": str(d2x_expr),
                "d2yExpr": str(d2y_expr),
                "slopeRule": "dy/dx = y′(t) / x′(t)",
                "speedRule": "‖v(t)‖ = √((x′(t))² + (y′(t))²)",
                "arcLengthRule": "L = ∫‖v(t)‖ dt",
                "secondDerivRule": "d²y/dx² = (y″x′ − y′x″) / (x′)³",
                "arcLength": arc_len,
                "tRange": [tmin, tmax],
                "xRange": x_range,
                "yRange": y_range,
                "vectors": _sample_vectors(x_vals, y_vals, dx_vals, dy_vals, t_vals),
                "tangents": _tangent_segments(x_vals, y_vals, dydx, t_vals),
            }
        except Exception as exc:
            return {"ok": False, "error": f"{exc}"}


def main():
    launch_app(
        ParametricApi(),
        "ui/parametric/index.html",
        title="Parametric Visualizer",
    )


if __name__ == "__main__":
    main()
