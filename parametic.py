from __future__ import annotations

import numpy as np
import sympy as sp

from graph import (
    launch_app,
    parse_expr,
    sample_domain,
    safe_eval,
    to_js_array,
)

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
]

PRESETS = [
    ("Circle", "cos(t)", "sin(t)"),
    ("Cycloid", "t - sin(t)", "1 - cos(t)"),
    ("Lissajous", "sin(3*t)", "sin(4*t)"),
    ("Spiral", "t*cos(t)", "t*sin(t)"),
]


def parse_param_expr(text: str):
    return sp.sympify(text, locals=PARSE_LOCALS)


def safe_eval_t(expr, t_vals, clip=1e9):
    try:
        f = sp.lambdify(t, expr, modules=["numpy"])

        with np.errstate(divide="ignore", invalid="ignore", over="ignore"):
            y = np.asarray(f(t_vals), dtype=float)

        if y.ndim == 0:
            y = np.full_like(t_vals, float(y), dtype=float)

        y = np.where(np.isfinite(y), y, np.nan)
        return np.clip(y, -clip, clip)

    except Exception:
        return np.full_like(t_vals, np.nan, dtype=float)


class ParametricApi:
    def get_bootstrap(self):
        return {
            "hints": FUNCTION_HINTS,
            "presets": PRESETS,
        }

    def compute(self, payload):
        try:
            x_expr_text = (payload or {}).get("xExpr", "").strip()
            y_expr_text = (payload or {}).get("yExpr", "").strip()

            if not x_expr_text or not y_expr_text:
                return {"ok": False, "error": "Please enter x(t) and y(t)."}

            tmin = float((payload or {}).get("tmin", -10.0))
            tmax = float((payload or {}).get("tmax", 10.0))
            samples = int((payload or {}).get("samples", 1600))

            if tmin >= tmax:
                return {"ok": False, "error": "tmin must be < tmax."}

            x_expr = parse_param_expr(x_expr_text)
            y_expr = parse_param_expr(y_expr_text)

            t_vals = sample_domain(tmin, tmax, samples)

            x_vals = safe_eval_t(x_expr, t_vals)
            y_vals = safe_eval_t(y_expr, t_vals)

            dx_expr = sp.simplify(sp.diff(x_expr, t))
            dy_expr = sp.simplify(sp.diff(y_expr, t))

            dx_vals = safe_eval_t(dx_expr, t_vals)
            dy_vals = safe_eval_t(dy_expr, t_vals)

            speed_expr = sp.simplify(sp.sqrt(dx_expr**2 + dy_expr**2))
            speed_vals = safe_eval_t(speed_expr, t_vals)

            finite_x = x_vals[np.isfinite(x_vals)]
            finite_y = y_vals[np.isfinite(y_vals)]

            if len(finite_x) == 0 or len(finite_y) == 0:
                return {"ok": False, "error": "Invalid parametric curve."}

            xmin, xmax = float(np.min(finite_x)), float(np.max(finite_x))
            ymin, ymax = float(np.min(finite_y)), float(np.max(finite_y))

            xpad = max((xmax - xmin) * 0.15, 1.0)
            ypad = max((ymax - ymin) * 0.15, 1.0)

            return {
                "ok": True,

                "t": to_js_array(t_vals),

                "xCurve": to_js_array(x_vals),
                "yCurve": to_js_array(y_vals),

                "dxdt": to_js_array(dx_vals),
                "dydt": to_js_array(dy_vals),

                "speed": to_js_array(speed_vals),

                "xExpr": str(x_expr),
                "yExpr": str(y_expr),

                "dxExpr": str(dx_expr),
                "dyExpr": str(dy_expr),
                "speedExpr": str(speed_expr),

                "xRange": [xmin - xpad, xmax + xpad],
                "yRange": [ymin - ypad, ymax + ypad],
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