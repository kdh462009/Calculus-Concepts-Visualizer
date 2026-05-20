#!/usr/bin/env python3
"""
Polar area visualizer backend — AP Calc BC Unit 9.
"""

from __future__ import annotations

import numpy as np
import sympy as sp

from graph import launch_app, sample_domain, to_js_array

theta = sp.symbols("theta", real=True)

PARSE_LOCALS = {
    "theta": theta,
    "t": theta,
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
    "abs": sp.Abs,
}

ANGLE_PARSE_LOCALS = {
    "pi": sp.pi,
    "e": sp.E,
    "E": sp.E,
    "sqrt": sp.sqrt,
}

PRESETS = [
    ("Cardioid", "1 + cos(theta)", None, "0", "2*pi"),
    ("Rose r=sin(3θ)", "sin(3*theta)", None, "0", "pi"),
    ("Circle r=2cosθ", "2*cos(theta)", None, "-pi/2", "pi/2"),
    ("Two circles", "2*cos(theta)", "1", "-pi/2", "pi/2"),
    ("Limacon", "2 + cos(theta)", None, "0", "2*pi"),
]


def parse_polar_expr(text: str):
    return sp.sympify(text, locals=PARSE_LOCALS)


def parse_angle_bound(value, default: float) -> float:
    """Parse α/β inputs: plain numbers or expressions like pi, 2*pi, -pi/2."""
    if value is None:
        return float(default)
    if isinstance(value, (int, float, np.floating)):
        out = float(value)
        if not np.isfinite(out):
            raise ValueError("Angle bound must be a finite number.")
        return out

    text = str(value).strip()
    if not text:
        return float(default)

    try:
        out = float(text)
        if not np.isfinite(out):
            raise ValueError(f"Could not evaluate angle bound: {text!r}")
        return out
    except ValueError:
        pass

    try:
        expr = sp.sympify(text, locals=ANGLE_PARSE_LOCALS)
    except (sp.SympifyError, TypeError, SyntaxError) as exc:
        raise ValueError(f"Could not parse angle bound: {text!r}") from exc
    if expr.has(theta):
        raise ValueError("Angle bounds must not depend on θ.")
    try:
        out = float(sp.N(expr))
    except (TypeError, ValueError) as exc:
        raise ValueError(f"Could not evaluate angle bound: {text!r}") from exc
    if not np.isfinite(out):
        raise ValueError(f"Could not evaluate angle bound: {text!r}")
    return out


def safe_eval_theta(expr, th_vals, clip=1.0e6):
    try:
        f = sp.lambdify(theta, expr, modules=["numpy"])
        with np.errstate(divide="ignore", invalid="ignore", over="ignore", under="ignore"):
            y = np.asarray(f(th_vals), dtype=float)
        if y.ndim == 0:
            y = np.full_like(th_vals, float(y), dtype=float)
        y = np.where(np.isfinite(y), y, np.nan)
        return np.clip(y, -clip, clip)
    except Exception:
        return np.full_like(th_vals, np.nan, dtype=float)


def _to_xy(r_vals: np.ndarray, th_vals: np.ndarray):
    return r_vals * np.cos(th_vals), r_vals * np.sin(th_vals)


def _symmetric_view(x_vals, y_vals) -> tuple[list[float], list[float]]:
    valid = np.isfinite(x_vals) & np.isfinite(y_vals)
    if np.count_nonzero(valid) < 4:
        return [-3.0, 3.0], [-3.0, 3.0]
    xv = x_vals[valid]
    yv = y_vals[valid]
    radius = float(np.max(np.hypot(xv, yv)))
    radius = max(radius * 1.18, 1.0)
    return [-radius, radius], [-radius, radius]


def _interp_r(th_vals, r_vals, t):
    return float(np.interp(t, th_vals, r_vals))


def _outer_inner(r1: float, r2: float) -> tuple[float, float]:
    a1 = max(float(r1), 0.0)
    a2 = max(float(r2), 0.0)
    return (max(a1, a2), min(a1, a2))


def _find_intersections_eval(f1, f2, th_vals):
    diff = f1(th_vals) - f2(th_vals)
    intersections = []
    for i in range(len(th_vals) - 1):
        d0, d1 = diff[i], diff[i + 1]
        if not (np.isfinite(d0) and np.isfinite(d1)):
            continue
        if abs(d0) < 1e-10:
            intersections.append(float(th_vals[i]))
            continue
        if d0 * d1 < 0:
            lo, hi = float(th_vals[i]), float(th_vals[i + 1])
            fd0 = d0
            for _ in range(50):
                mid = 0.5 * (lo + hi)
                dm = float(f1(mid) - f2(mid))
                if not np.isfinite(dm):
                    break
                if abs(dm) < 1e-11:
                    lo = hi = mid
                    break
                if fd0 * dm <= 0:
                    hi = mid
                else:
                    lo = mid
                    fd0 = dm
            intersections.append(0.5 * (lo + hi))
    out = []
    for ang in sorted(intersections):
        if not out or abs(ang - out[-1]) > 1e-4:
            out.append(ang)
    return out


def _sector_payload(i, t0, t1, r_inner_0, r_inner_1, r_outer_0, r_outer_1, area, cumulative):
    return {
        "index": i,
        "theta0": t0,
        "theta1": t1,
        "rInner0": r_inner_0,
        "rInner1": r_inner_1,
        "rOuter0": r_outer_0,
        "rOuter1": r_outer_1,
        "area": area,
        "cumulative": cumulative,
    }


def _build_sectors_single(th_vals, r_vals, n_sectors):
    alpha, beta = float(th_vals[0]), float(th_vals[-1])
    edges = np.linspace(alpha, beta, n_sectors + 1)
    sectors = []
    cumulative = 0.0
    for i in range(n_sectors):
        t0, t1 = float(edges[i]), float(edges[i + 1])
        d_theta = t1 - t0
        r0 = max(_interp_r(th_vals, r_vals, t0), 0.0)
        r1 = max(_interp_r(th_vals, r_vals, t1), 0.0)
        rm = max(_interp_r(th_vals, r_vals, 0.5 * (t0 + t1)), 0.0)
        area = 0.5 * (rm ** 2) * d_theta
        cumulative += area
        sectors.append(_sector_payload(i, t0, t1, 0.0, 0.0, r0, r1, area, cumulative))
    return sectors, cumulative


def _build_sectors_compare(th_vals, r1_vals, r2_vals, n_sectors):
    alpha, beta = float(th_vals[0]), float(th_vals[-1])
    edges = np.linspace(alpha, beta, n_sectors + 1)
    sectors = []
    cumulative = 0.0
    for i in range(n_sectors):
        t0, t1 = float(edges[i]), float(edges[i + 1])
        d_theta = t1 - t0
        r1_0 = _interp_r(th_vals, r1_vals, t0)
        r1_1 = _interp_r(th_vals, r1_vals, t1)
        r2_0 = _interp_r(th_vals, r2_vals, t0)
        r2_1 = _interp_r(th_vals, r2_vals, t1)
        rm1 = _interp_r(th_vals, r1_vals, 0.5 * (t0 + t1))
        rm2 = _interp_r(th_vals, r2_vals, 0.5 * (t0 + t1))
        ro, ri = _outer_inner(rm1, rm2)
        ro0, ri0 = _outer_inner(r1_0, r2_0)
        ro1, ri1 = _outer_inner(r1_1, r2_1)
        area = 0.5 * (ro ** 2 - ri ** 2) * d_theta
        cumulative += area
        sectors.append(_sector_payload(i, t0, t1, ri0, ri1, ro0, ro1, area, cumulative))
    return sectors, cumulative


def _high_res_area_single(r_expr, alpha, beta):
    th = np.linspace(alpha, beta, 8000)
    r = safe_eval_theta(r_expr, th)
    valid = np.isfinite(r)
    return float(np.trapezoid(0.5 * np.clip(r[valid], 0, None) ** 2, th[valid]))


def _high_res_area_compare(r1_expr, r2_expr, alpha, beta):
    th = np.linspace(alpha, beta, 8000)
    r1 = safe_eval_theta(r1_expr, th)
    r2 = safe_eval_theta(r2_expr, th)
    valid = np.isfinite(r1) & np.isfinite(r2)
    r1v = np.clip(r1[valid], 0, None)
    r2v = np.clip(r2[valid], 0, None)
    integrand = 0.5 * (np.maximum(r1v, r2v) ** 2 - np.minimum(r1v, r2v) ** 2)
    return float(np.trapezoid(integrand, th[valid]))


class PolarApi:
    def get_bootstrap(self):
        return {
            "presets": PRESETS,
            "modes": [
                ("single", "Single curve r(θ)"),
                ("compare", "Compare two curves"),
            ],
        }

    def compute(self, payload):
        try:
            mode = str((payload or {}).get("mode", "single")).strip().lower()
            r_text = (payload or {}).get("rExpr", "1 + cos(theta)").strip()
            r2_text = (payload or {}).get("r2Expr", "1").strip()
            try:
                alpha = parse_angle_bound((payload or {}).get("alpha"), 0.0)
                beta = parse_angle_bound((payload or {}).get("beta"), float(2 * np.pi))
            except (ValueError, sp.SympifyError) as exc:
                return {"ok": False, "error": f"Invalid angle bound: {exc}"}
            n_sectors = int((payload or {}).get("nSectors", 16))
            samples = int((payload or {}).get("samples", 1800))

            if alpha >= beta:
                return {"ok": False, "error": "α must be < β."}
            if n_sectors < 4:
                n_sectors = 4

            r_expr = parse_polar_expr(r_text)
            th_vals = sample_domain(alpha, beta, samples)
            r_vals = safe_eval_theta(r_expr, th_vals)
            x_vals, y_vals = _to_xy(r_vals, th_vals)

            if mode == "compare":
                if not r2_text:
                    return {"ok": False, "error": "Please enter r₂(θ) for compare mode."}
                r2_expr = parse_polar_expr(r2_text)
                r2_vals = safe_eval_theta(r2_expr, th_vals)
                x2_vals, y2_vals = _to_xy(r2_vals, th_vals)

                f1 = sp.lambdify(theta, r_expr, modules=["numpy"])
                f2 = sp.lambdify(theta, r2_expr, modules=["numpy"])
                intersections = _find_intersections_eval(f1, f2, np.linspace(alpha, beta, 4000))
                sectors, sector_sum = _build_sectors_compare(th_vals, r_vals, r2_vals, n_sectors)
                exact_area = _high_res_area_compare(r_expr, r2_expr, alpha, beta)
                x_range, y_range = _symmetric_view(
                    np.concatenate([x_vals, x2_vals]),
                    np.concatenate([y_vals, y2_vals]),
                )
                return {
                    "ok": True,
                    "mode": "compare",
                    "rExpr": str(r_expr),
                    "r2Expr": str(r2_expr),
                    "alpha": alpha,
                    "beta": beta,
                    "theta": to_js_array(th_vals),
                    "r": to_js_array(r_vals),
                    "r2": to_js_array(r2_vals),
                    "xCurve": to_js_array(x_vals),
                    "yCurve": to_js_array(y_vals),
                    "xCurve2": to_js_array(x2_vals),
                    "yCurve2": to_js_array(y2_vals),
                    "sectors": sectors,
                    "nSectors": n_sectors,
                    "totalArea": exact_area,
                    "sectorSum": sector_sum,
                    "intersections": intersections,
                    "areaFormula": "A = (1/2) ∫[α,β] (r_outer² − r_inner²) dθ",
                    "xRange": x_range,
                    "yRange": y_range,
                }

            if not np.any(np.isfinite(r_vals)):
                return {"ok": False, "error": "Could not evaluate r(θ) on this interval."}

            sectors, sector_sum = _build_sectors_single(th_vals, r_vals, n_sectors)
            exact_area = _high_res_area_single(r_expr, alpha, beta)
            x_range, y_range = _symmetric_view(x_vals, y_vals)

            return {
                "ok": True,
                "mode": "single",
                "rExpr": str(r_expr),
                "alpha": alpha,
                "beta": beta,
                "theta": to_js_array(th_vals),
                "r": to_js_array(r_vals),
                "xCurve": to_js_array(x_vals),
                "yCurve": to_js_array(y_vals),
                "sectors": sectors,
                "nSectors": n_sectors,
                "totalArea": exact_area,
                "sectorSum": sector_sum,
                "intersections": [],
                "areaFormula": "A = (1/2) ∫[α,β] r² dθ",
                "xRange": x_range,
                "yRange": y_range,
            }
        except Exception as exc:
            return {"ok": False, "error": f"{exc}"}


def main():
    launch_app(
        PolarApi(),
        "ui/polar/index.html",
        title="Polar Area Visualizer",
    )


if __name__ == "__main__":
    main()
