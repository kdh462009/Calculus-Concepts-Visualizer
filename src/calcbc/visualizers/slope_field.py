#!/usr/bin/env python3
"""
Slope field + IVP visualizer backend — DiffEQ.

y' = f(x, y). Ticks show the field; Euler / Midpoint / RK4 trace
the solution through a dragged initial condition.
"""

from __future__ import annotations

import numpy as np
import sympy as sp

from calcbc.graph import classroom_str, launch_app, parse_user_expr, to_js_array

x, y = sp.symbols("x y", real=True)

PARSE_LOCALS = {
    "x": x,
    "y": y,
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
    "x - y",
    "y",
    "-x/y",
    "x*y",
    "y*(1 - y)",
    "sin(x)*y",
    "1 + y^2",
    "x^2 - y",
    "-y + sin(x)",
]

PRESETS = [
    ("x − y", "x - y"),
    ("y", "y"),
    ("circles −x/y", "-x/y"),
    ("x y", "x*y"),
    ("logistic", "y*(1 - y)"),
    ("1 + y²", "1 + y^2"),
]

METHODS = ("euler", "midpoint", "rk4")
F_CLIP = 1.0e6
MAX_STEPS = 1600
H_MIN = 1e-3
H_MAX = 2.0


def parse_f(text: str):
    expr = parse_user_expr(text, PARSE_LOCALS)
    extra = expr.free_symbols - {x, y}
    if extra:
        names = ", ".join(sorted(str(s) for s in extra))
        raise ValueError(f"y' can only use x and y, not {names}.")
    return expr


def _as_float(value, default: float) -> float:
    if value is None or value == "":
        return float(default)
    try:
        out = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError("Expected a number.") from exc
    if not np.isfinite(out):
        raise ValueError("Expected a finite number.")
    return out


def make_f(expr):
    fn = sp.lambdify((x, y), expr, modules=["numpy"])

    def f(xv, yv):
        try:
            with np.errstate(divide="ignore", invalid="ignore", over="ignore", under="ignore"):
                out = fn(xv, yv)
            val = float(np.asarray(out, dtype=float).reshape(-1)[0])
            if not np.isfinite(val):
                return np.nan
            if abs(val) > F_CLIP:
                return np.nan
            return val
        except Exception:
            return np.nan

    return f


def _step_euler(f, xn, yn, h):
    k = f(xn, yn)
    if not np.isfinite(k):
        return np.nan, np.nan, np.nan
    return xn + h, yn + h * k, k


def _step_midpoint(f, xn, yn, h):
    k1 = f(xn, yn)
    if not np.isfinite(k1):
        return np.nan, np.nan, np.nan
    k2 = f(xn + 0.5 * h, yn + 0.5 * h * k1)
    if not np.isfinite(k2):
        return np.nan, np.nan, np.nan
    return xn + h, yn + h * k2, k1


def _step_rk4(f, xn, yn, h):
    k1 = f(xn, yn)
    if not np.isfinite(k1):
        return np.nan, np.nan, np.nan
    k2 = f(xn + 0.5 * h, yn + 0.5 * h * k1)
    if not np.isfinite(k2):
        return np.nan, np.nan, np.nan
    k3 = f(xn + 0.5 * h, yn + 0.5 * h * k2)
    if not np.isfinite(k3):
        return np.nan, np.nan, np.nan
    k4 = f(xn + h, yn + h * k3)
    if not np.isfinite(k4):
        return np.nan, np.nan, np.nan
    return xn + h, yn + (h / 6.0) * (k1 + 2 * k2 + 2 * k3 + k4), k1


STEPPERS = {
    "euler": _step_euler,
    "midpoint": _step_midpoint,
    "rk4": _step_rk4,
}


def _inside(xv, yv, x_lo, x_hi, y_lo, y_hi) -> bool:
    return (
        np.isfinite(xv)
        and np.isfinite(yv)
        and x_lo <= xv <= x_hi
        and y_lo <= yv <= y_hi
    )


def _too_steep(slope, h, y_span) -> bool:
    if not np.isfinite(slope):
        return True
    if abs(slope) > 80:
        return True
    return abs(h * slope) > max(0.35 * y_span, 1.0)


def integrate_branch(f, x0, y0, h, x_limit, y_lo, y_hi, stepper, y_span, max_steps=MAX_STEPS):
    """Walk from (x0, y0) with step h until x_limit or the path leaves the pad."""
    xs = [float(x0)]
    ys = [float(y0)]
    slopes = [f(x0, y0)]
    xn, yn = float(x0), float(y0)
    going_right = h > 0
    for _ in range(max_steps):
        if going_right and xn >= x_limit:
            break
        if not going_right and xn <= x_limit:
            break
        if not _inside(xn, yn, min(x0, x_limit) - abs(h), max(x0, x_limit) + abs(h), y_lo, y_hi):
            break
        slope_now = f(xn, yn)
        if _too_steep(slope_now, h, y_span):
            break
        x_next, y_next, slope = stepper(f, xn, yn, h)
        if not (np.isfinite(x_next) and np.isfinite(y_next)):
            break
        if abs(y_next) > 1e8 or _too_steep(slope, h, y_span):
            break
        xs.append(float(x_next))
        ys.append(float(y_next))
        slopes.append(float(slope) if np.isfinite(slope) else None)
        xn, yn = x_next, y_next
        if not (y_lo <= yn <= y_hi):
            break
    return xs, ys, slopes


def build_ticks(f, xmin, xmax, ymin, ymax, n: int):
    n = int(np.clip(n, 6, 36))
    xs = np.linspace(xmin, xmax, n)
    ys = np.linspace(ymin, ymax, n)
    tick_x = []
    tick_y = []
    tick_s = []
    for xv in xs:
        for yv in ys:
            slope = f(float(xv), float(yv))
            if not np.isfinite(slope):
                continue
            tick_x.append(float(xv))
            tick_y.append(float(yv))
            tick_s.append(float(slope))
    return tick_x, tick_y, tick_s


def _pack_branch(xs, ys, slopes):
    return {
        "x": to_js_array(xs),
        "y": to_js_array(ys),
        "slopes": [None if s is None or not np.isfinite(s) else float(s) for s in slopes],
    }


def integrate_method(f, name, x0, y0, h, xmin, xmax, ymin, ymax):
    stepper = STEPPERS[name]
    x_pad = max((xmax - xmin) * 0.08, abs(h))
    y_pad = max((ymax - ymin) * 0.65, 1.0)
    y_lo, y_hi = ymin - y_pad, ymax + y_pad
    y_span = max(ymax - ymin, 1e-6)
    fwd = integrate_branch(f, x0, y0, h, xmax + x_pad, y_lo, y_hi, stepper, y_span)
    back = integrate_branch(f, x0, y0, -h, xmin - x_pad, y_lo, y_hi, stepper, y_span)
    return {
        "forward": _pack_branch(*fwd),
        "backward": _pack_branch(*back),
    }


class SlopeFieldApi:
    def get_bootstrap(self):
        return {
            "hints": FUNCTION_HINTS,
            "presets": PRESETS,
            "methods": [
                ("euler", "Euler"),
                ("midpoint", "Midpoint"),
                ("rk4", "RK4"),
            ],
        }

    def compute(self, payload):
        try:
            data = payload or {}
            expr_text = str(data.get("expr") or data.get("fExpr") or "").strip()
            if not expr_text:
                return {"ok": False, "error": "Please enter y' = f(x, y)."}

            xmin = _as_float(data.get("xmin"), -4.0)
            xmax = _as_float(data.get("xmax"), 4.0)
            ymin = _as_float(data.get("ymin"), -4.0)
            ymax = _as_float(data.get("ymax"), 4.0)
            if xmin >= xmax:
                return {"ok": False, "error": "xmin must be < xmax."}
            if ymin >= ymax:
                return {"ok": False, "error": "ymin must be < ymax."}

            grid_n = int(data.get("gridN", 16) or 16)
            h = float(np.clip(_as_float(data.get("h"), 0.25), H_MIN, H_MAX))
            want_ivp = bool(data.get("integrate", True))
            x0 = _as_float(data.get("x0"), 0.0)
            y0 = _as_float(data.get("y0"), 1.0)

            raw_methods = data.get("methods") or list(METHODS)
            methods = []
            for item in raw_methods:
                key = str(item).strip().lower()
                if key in STEPPERS and key not in methods:
                    methods.append(key)
            if not methods:
                methods = ["euler"]

            expr = parse_f(expr_text)
            f = make_f(expr)
            tick_x, tick_y, tick_s = build_ticks(f, xmin, xmax, ymin, ymax, grid_n)

            solutions = {}
            if want_ivp:
                for name in methods:
                    solutions[name] = integrate_method(
                        f, name, x0, y0, h, xmin, xmax, ymin, ymax
                    )

            return {
                "ok": True,
                "expr": classroom_str(expr),
                "xRange": [xmin, xmax],
                "yRange": [ymin, ymax],
                "x0": x0,
                "y0": y0,
                "h": h,
                "gridN": int(np.clip(grid_n, 6, 36)),
                "tickX": tick_x,
                "tickY": tick_y,
                "tickSlope": tick_s,
                "solutions": solutions,
                "methods": methods,
                "slopeAtIC": (
                    None
                    if not np.isfinite(f(x0, y0))
                    else float(f(x0, y0))
                ),
            }
        except Exception as exc:
            return {"ok": False, "error": f"{exc}"}


def main():
    launch_app(
        SlopeFieldApi(),
        "ui/slope_field/index.html",
        title="Slope Field Visualizer",
    )


if __name__ == "__main__":
    main()
