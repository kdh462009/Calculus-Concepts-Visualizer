#!/usr/bin/env python3
"""
Core graphing utilities for pywebview visualization apps.
"""

from __future__ import annotations

import base64
import io
import sys
from pathlib import Path

import numpy as np
import sympy as sp
import webview
from matplotlib.backends.backend_agg import FigureCanvasAgg
from matplotlib.figure import Figure
from sympy.parsing.sympy_parser import (
    convert_xor,
    implicit_multiplication_application,
    parse_expr as sympy_parse_expr,
    standard_transformations,
)

x = sp.symbols("x")

_PARSE_TRANSFORMATIONS = standard_transformations + (
    convert_xor,
    implicit_multiplication_application,
)

PARSE_LOCALS = {
    "x": x,
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

PROJECT_ROOT = Path(__file__).resolve().parent


def resolve_resource(path: str, base: Path | None = None) -> Path:
    root = base or PROJECT_ROOT
    if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
        return Path(sys._MEIPASS) / path
    return root / path


def parse_user_expr(text: str, local_dict):
    """Parse classroom notation: 2x, 3sin(x), x^2, e^x. Reject comma-pairs."""
    raw = (text or "").strip()
    if not raw:
        raise ValueError("Please enter an expression.")
    try:
        expr = sympy_parse_expr(
            raw,
            local_dict=local_dict,
            transformations=_PARSE_TRANSFORMATIONS,
        )
    except Exception as exc:
        raise ValueError(f"Could not parse expression: {raw}") from exc
    if isinstance(expr, (tuple, list, sp.Tuple)):
        raise ValueError("Enter a single expression, not a comma-separated pair.")
    return expr


def parse_expr(text: str):
    return parse_user_expr(text, PARSE_LOCALS)


def mask_vertical_jumps(y):
    """Insert NaNs at sign-changing spikes so polylines break at asymptotes."""
    y = np.asarray(y, dtype=float).copy()
    if y.size < 3:
        return y
    dy = np.abs(np.diff(y))
    finite_dy = dy[np.isfinite(dy)]
    if finite_dy.size < 4:
        typical = 1.0
    else:
        typical = float(np.median(finite_dy))
    thresh = max(8.0, typical * 18.0)
    for i in range(y.size - 1):
        a, b = y[i], y[i + 1]
        if not (np.isfinite(a) and np.isfinite(b)):
            continue
        gap = abs(b - a)
        if a * b < 0 and gap > max(1.25, typical * 8.0):
            y[i + 1] = np.nan
            continue
        if gap < thresh:
            continue
        if abs(a) > thresh or abs(b) > thresh:
            y[i + 1] = np.nan
    return y


def safe_eval(expr_sympy, x_vals, clip=1.0e6, break_jumps=True):
    try:
        f = sp.lambdify(x, expr_sympy, modules=["numpy"])
        with np.errstate(divide="ignore", invalid="ignore", over="ignore", under="ignore"):
            y = np.asarray(f(x_vals), dtype=float)
        if y.ndim == 0:
            y = np.full_like(x_vals, float(y), dtype=float)
        elif y.shape != x_vals.shape:
            y = np.broadcast_to(y, x_vals.shape).astype(float, copy=False)
        y = np.where(np.isfinite(y), y, np.nan)
        if clip is not None:
            saturated = np.isfinite(y) & (np.abs(y) >= clip)
            y = np.clip(y, -clip, clip)
            y = np.where(saturated, np.nan, y)
        if break_jumps:
            y = mask_vertical_jumps(y)
        return y
    except Exception:
        return np.full_like(x_vals, np.nan, dtype=float)


def to_js_array(arr):
    arr = np.asarray(arr, dtype=float)
    if arr.ndim == 0:
        arr = np.array([float(arr)], dtype=float)
    out = []
    for v in arr.reshape(-1):
        out.append(float(v) if np.isfinite(v) else None)
    return out


def compute_y_range(y_true, default=(-10.0, 10.0)):
    y_valid = y_true[np.isfinite(y_true)]
    if len(y_valid):
        yc = float(np.median(y_valid))
        yr = float(max(np.percentile(np.abs(y_valid - yc), 95), 1.0) * 1.6)
        return yc - yr, yc + yr
    return default


def combined_y_range(*arrays, default=(-10.0, 10.0)):
    chunks = []
    for arr in arrays:
        if arr is None:
            continue
        a = np.asarray(arr, dtype=float)
        if a.ndim == 0:
            a = np.array([float(a)], dtype=float)
        fin = a[np.isfinite(a)]
        if fin.size:
            chunks.append(fin)
    if not chunks:
        return default
    all_vals = np.concatenate(chunks)
    lo = float(np.nanpercentile(all_vals, 4))
    hi = float(np.nanpercentile(all_vals, 96))
    if not np.isfinite(lo) or not np.isfinite(hi) or hi - lo < 1e-8:
        c = float(np.nanmedian(all_vals))
        return c - 1.0, c + 1.0
    pad = max(0.35, 0.16 * (hi - lo))
    return lo - pad, hi + pad


def sample_domain(xmin: float, xmax: float, samples: int = 1400):
    return np.linspace(xmin, xmax, max(samples, 500))


def render_latex_png(latex_body: str, color: str = "#f5c842") -> str:
    fig = Figure(figsize=(14, 0.85), dpi=200)
    fig.patch.set_alpha(0.0)
    ax = fig.add_subplot(111)
    ax.axis("off")
    ax.set_facecolor((0, 0, 0, 0))
    ax.text(
        0.01,
        0.5,
        f"${latex_body}$",
        color=color,
        fontsize=20,
        va="center",
        ha="left",
    )
    canvas = FigureCanvasAgg(fig)
    buf = io.BytesIO()
    canvas.print_png(buf)
    encoded = base64.b64encode(buf.getvalue()).decode("ascii")
    return f"data:image/png;base64,{encoded}"


def compute_function_preview(payload):
    """Sample f(x) over the plot window without approximation data."""
    try:
        expr_text = (payload or {}).get("expr", "").strip()
        if not expr_text:
            return {"ok": False, "error": "Please enter a function."}

        xmin = float((payload or {}).get("xmin", -4.0))
        xmax = float((payload or {}).get("xmax", 4.0))
        samples = int((payload or {}).get("samples", 1400))
        if xmin >= xmax:
            return {"ok": False, "error": "xmin must be < xmax."}

        expr = parse_expr(expr_text)
        x_vals = sample_domain(xmin, xmax, samples)
        y_true = safe_eval(expr, x_vals)
        return plot_payload(
            x_vals,
            y_true,
            x_range=[xmin, xmax],
            extra={"preview": True},
        )
    except Exception as exc:
        return {"ok": False, "error": f"{exc}"}


def plot_payload(
    x_vals,
    y_true,
    *,
    x_range=None,
    y_range=None,
    extra=None,
):
    xmin, xmax = x_range or (float(x_vals[0]), float(x_vals[-1]))
    if y_range is None:
        y_min, y_max = compute_y_range(y_true)
    else:
        y_min, y_max = y_range
    payload = {
        "ok": True,
        "x": [float(v) for v in x_vals],
        "yTrue": to_js_array(y_true),
        "xRange": [xmin, xmax],
        "yRange": [y_min, y_max],
    }
    if extra:
        payload.update(extra)
    return payload


def launch_app(
    api,
    ui_path: str,
    *,
    title: str = "Graph Visualizer",
    width: int = 1320,
    height: int = 860,
    min_size: tuple[int, int] = (1000, 680),
    background_color: str = "#0a1020",
    debug: bool = False,
):
    index_uri = resolve_resource(ui_path).as_uri()
    webview.create_window(
        title=title,
        url=index_uri,
        js_api=api,
        width=width,
        height=height,
        min_size=min_size,
        background_color=background_color,
    )
    webview.start(debug=debug)
