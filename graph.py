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

x = sp.symbols("x")

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
}

PROJECT_ROOT = Path(__file__).resolve().parent


def resolve_resource(path: str, base: Path | None = None) -> Path:
    root = base or PROJECT_ROOT
    if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
        return Path(sys._MEIPASS) / path
    return root / path


def parse_expr(text: str):
    return sp.sympify(text, locals=PARSE_LOCALS)


def safe_eval(expr_sympy, x_vals, clip=50):
    try:
        f = sp.lambdify(x, expr_sympy, modules=["numpy"])
        y = np.asarray(f(x_vals), dtype=float)
        if y.ndim == 0:
            y = np.full_like(x_vals, float(y), dtype=float)
        elif y.shape != x_vals.shape:
            y = np.broadcast_to(y, x_vals.shape).astype(float, copy=False)
        y = np.where(np.isfinite(y), y, np.nan)
        return np.clip(y, -clip, clip)
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
