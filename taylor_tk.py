#!/usr/bin/env python3
"""
Legacy Tkinter Taylor Series visualizer.

The pywebview desktop app lives in taylor.py (run via app.py).
Requires: pip install matplotlib sympy numpy tkinter (tkinter usually built-in)
"""

import tkinter as tk
from tkinter import ttk, messagebox, font as tkfont
import numpy as np
import sympy as sp
from sympy import symbols, series, lambdify, latex, sin, cos, tan, exp, log, sqrt, pi, E
import matplotlib
matplotlib.use("TkAgg")
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
from matplotlib.backends.backend_tkagg import FigureCanvasTkAgg, NavigationToolbar2Tk
from matplotlib.animation import FuncAnimation
import threading
import warnings
warnings.filterwarnings("ignore")

# ── Color Palette ──────────────────────────────────────────────────────────────
BG        = "#0a1020"
PANEL     = "#121a2d"
CARD      = "#1a2440"
CARD_HI   = "#27365b"
GLASS     = "#243252"
GLASS_EDGE = "#8ea3ff"
ACCENT    = "#7c6af7"       # violet
ACCENT2   = "#f06090"       # coral-pink
GOLD      = "#f5c842"
TEAL      = "#2ee8bb"
TXT       = "#e8eaf6"
TXT_DIM   = "#7b82a0"
TXT_DARK  = "#151827"
BORDER    = "#2b365b"
GRAD_COLS = [
    "#7c6af7","#9b5de5","#f06090","#f5c842",
    "#2ee8bb","#60efff","#ff6b6b","#ffa500"
]
DARK_GRAD_COLS = [
    "#2c215f", "#3a235e", "#4f1f4a", "#5f4620",
    "#1d4f46", "#1a4d5e", "#5a232d", "#5c350f"
]
FUNCTION_HINTS = [
    "sin(x)", "cos(x)", "tan(x)", "exp(x)", "log(x)", "log(1+x)",
    "sqrt(1+x)", "atan(x)", "asin(x)", "acos(x)", "sinh(x)", "cosh(x)",
    "tanh(x)", "1/(1-x)", "x**2 + 2*x + 1", "pi", "E"
]

# ── Preset equations ───────────────────────────────────────────────────────────
PRESETS = {
    "sin(x)"      : "sin(x)",
    "cos(x)"      : "cos(x)",
    "eˣ"          : "exp(x)",
    "ln(1+x)"     : "log(1+x)",
    "tan(x)"      : "tan(x)",
    "1/(1−x)"     : "1/(1-x)",
    "√(1+x)"      : "sqrt(1+x)",
    "x²+2x+1"     : "x**2 + 2*x + 1",
    "sinh(x)"     : "sinh(x)",
    "arctan(x)"   : "atan(x)",
}

x = symbols('x')


def parse_expr(text: str):
    """Safely parse a user expression string into a SymPy expression."""
    local_dict = {
        'x': x, 'sin': sp.sin, 'cos': sp.cos, 'tan': sp.tan,
        'exp': sp.exp, 'e': E, 'E': E, 'log': sp.log, 'ln': sp.log,
        'sqrt': sp.sqrt, 'pi': pi, 'sinh': sp.sinh, 'cosh': sp.cosh,
        'tanh': sp.tanh, 'asin': sp.asin, 'acos': sp.acos,
        'atan': sp.atan, 'arctan': sp.atan,
    }
    return sp.sympify(text, locals=local_dict)


def get_taylor_terms(expr, center=0, n_terms=10):
    """Return a list of partial-sum SymPy expressions (1 term, 2 terms, …)."""
    raw = series(expr, x, center, n=n_terms+2)
    # Remove O() remainder
    poly = raw.removeO()
    # Collect individual terms sorted by degree
    poly_expr = sp.Poly(sp.expand(poly), x)
    all_terms = poly_expr.as_expr()
    # Build progressive sums from the series object
    series_terms = []
    accumulated = sp.Integer(0)
    for k in range(n_terms + 2):
        coeff = raw.coeff(x, k)
        if coeff != 0:
            term = coeff * x**k
            accumulated += term
            series_terms.append(sp.simplify(accumulated))
    return series_terms, sp.expand(poly)


def safe_eval(expr_sympy, x_vals, clip=50):
    """Numerically evaluate a SymPy expression, clipping blow-ups."""
    try:
        f = lambdify(x, expr_sympy, modules=['numpy'])
        y = f(x_vals)
        y = np.where(np.isfinite(y), y, np.nan)
        y = np.clip(y, -clip, clip)
        return y
    except Exception:
        return np.full_like(x_vals, np.nan, dtype=float)


# ══════════════════════════════════════════════════════════════════════════════
class TaylorApp(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("Taylor Series Visualizer")
        self.configure(bg=BG)
        self.geometry("1280x820")
        self.minsize(1000, 700)
        self.resizable(True, True)

        self._anim       = None
        self._anim_running = False
        self._anim_paused = False
        self._terms      = []
        self._full_poly  = None
        self._x_range    = (-4, 4)
        self._center     = 0
        self._autocomplete_items = []
        self._autocomplete_visible = False
        self._selected_suggestion_idx = -1

        self._setup_fonts()
        self._build_ui()

    # ── Fonts ─────────────────────────────────────────────────────────────────
    def _setup_fonts(self):
        families = set(tkfont.families())
        ui_font = "SF Pro Display" if "SF Pro Display" in families else "Helvetica"
        mono_font = "SF Mono" if "SF Mono" in families else "Menlo"
        self.fnt_title  = (ui_font, 23, "bold")
        self.fnt_label  = (ui_font, 11)
        self.fnt_small  = (ui_font, 10)
        self.fnt_mono   = (mono_font, 11)
        self.fnt_big    = (ui_font, 15, "bold")

    # ── Layout ────────────────────────────────────────────────────────────────
    def _build_ui(self):
        # ── Header ────────────────────────────────────────────────────────────
        hdr = tk.Frame(self, bg=BG)
        hdr.pack(fill="x", padx=20, pady=(18, 0))
        title_row = tk.Frame(hdr, bg=BG)
        title_row.pack(fill="x")
        tk.Label(title_row, text="∑  TAYLOR SERIES", font=self.fnt_title,
                 fg=ACCENT, bg=BG).pack(side="left")
        tk.Label(title_row, text="  animated approximation engine",
                 font=self.fnt_label, fg=TXT_DIM, bg=BG).pack(side="left", pady=4)

        self._header_poly_var = tk.StringVar(
            value="P_n(x) = f(a) + f'(a)(x-a)/1! + f''(a)(x-a)^2/2! + ..."
        )
        self._header_poly_lbl = tk.Label(
            hdr, textvariable=self._header_poly_var,
            font=self.fnt_small, fg=GOLD, bg=BG, anchor="w",
            justify="left"
        )
        self._header_poly_lbl.pack(fill="x", pady=(2, 0))

        # ── Main split ────────────────────────────────────────────────────────
        body = tk.Frame(self, bg=BG)
        body.pack(fill="both", expand=True, padx=20, pady=12)

        # Left control panel
        ctrl = tk.Frame(body, bg=PANEL, width=300, relief="flat",
                        highlightbackground=GLASS_EDGE, highlightthickness=1)
        ctrl.pack(side="left", fill="y", padx=(0, 14))
        ctrl.pack_propagate(False)
        self._build_controls(ctrl)

        # Right: plot area + polynomial display
        right = tk.Frame(body, bg=BG)
        right.pack(side="left", fill="both", expand=True)
        self._build_plot(right)
        self._build_poly_display(right)

    # ── Control Panel ─────────────────────────────────────────────────────────
    def _build_controls(self, parent):
        pad = dict(padx=16, pady=6)

        tk.Label(parent, text="FUNCTION", font=self.fnt_small,
                 fg=ACCENT, bg=PANEL).pack(anchor="w", **pad)

        # Equation entry
        entry_frame = tk.Frame(parent, bg=GLASS,
                               highlightbackground=GLASS_EDGE, highlightthickness=1)
        entry_frame.pack(fill="x", padx=16, pady=(0, 8))
        self._eq_var = tk.StringVar(value="sin(x)")
        self._eq_entry = tk.Entry(entry_frame, textvariable=self._eq_var,
                                  font=self.fnt_mono, bg=GLASS, fg=GOLD,
                                  insertbackground=GOLD, bd=0,
                                  highlightthickness=0)
        self._eq_entry.pack(fill="x", padx=10, pady=8)
        self._eq_entry.bind("<Return>", lambda e: self._on_animate())
        self._eq_entry.bind("<KeyRelease>", self._on_eq_keyrelease)
        self._eq_entry.bind("<Down>", self._suggestion_down)
        self._eq_entry.bind("<Up>", self._suggestion_up)
        self._eq_entry.bind("<Tab>", self._suggestion_accept_from_entry)
        self._eq_entry.bind("<Escape>", self._hide_suggestions)
        self._eq_entry.bind("<FocusOut>", self._hide_suggestions_delayed)

        self._suggestions_wrap = tk.Frame(parent, bg=PANEL)
        self._suggestions_wrap.pack(fill="x", padx=16, pady=(0, 8))
        self._suggestions = tk.Listbox(
            self._suggestions_wrap, height=5, font=self.fnt_mono,
            bg=GLASS, fg=TXT, bd=0, highlightthickness=1,
            highlightbackground=GLASS_EDGE, selectbackground=ACCENT,
            selectforeground="white", activestyle="none"
        )
        self._suggestions.bind("<ButtonRelease-1>", self._suggestion_accept_from_list)
        self._suggestions.bind("<Return>", self._suggestion_accept_from_list)
        self._suggestions.bind("<Escape>", self._hide_suggestions)
        self._suggestions.pack_forget()

        # Presets
        tk.Label(parent, text="PRESETS", font=self.fnt_small,
                 fg=ACCENT, bg=PANEL).pack(anchor="w", **pad)
        preset_frame = tk.Frame(parent, bg=PANEL)
        preset_frame.pack(fill="x", padx=16, pady=(0, 6))
        for i, (label, expr) in enumerate(PRESETS.items()):
            btn = tk.Button(preset_frame, text=label, font=self.fnt_small,
                            bg=CARD_HI, fg=TXT_DARK, activebackground=ACCENT,
                            activeforeground=TXT_DARK, disabledforeground=TXT_DARK,
                            bd=0, cursor="hand2",
                            command=lambda e=expr: self._set_preset(e),
                            padx=6, pady=4, relief="flat",
                            highlightbackground=GLASS_EDGE, highlightthickness=1)
            btn.grid(row=i//2, column=i%2, sticky="ew", padx=3, pady=3)
            self._attach_button_animation(btn, CARD_HI, "#344874", ACCENT)
        preset_frame.columnconfigure(0, weight=1)
        preset_frame.columnconfigure(1, weight=1)

        sep = tk.Frame(parent, bg=BORDER, height=1)
        sep.pack(fill="x", padx=16, pady=8)

        # Center point
        tk.Label(parent, text="EXPANSION CENTER  a =", font=self.fnt_small,
                 fg=ACCENT, bg=PANEL).pack(anchor="w", **pad)
        self._center_var = tk.DoubleVar(value=0.0)
        center_entry = tk.Entry(parent, textvariable=self._center_var,
                                font=self.fnt_mono, bg=GLASS, fg=TEAL,
                                insertbackground=TEAL, bd=0, width=8,
                                highlightbackground=BORDER, highlightthickness=1)
        center_entry.pack(anchor="w", padx=16, pady=(0, 10))

        # Terms slider
        tk.Label(parent, text="MAX TERMS", font=self.fnt_small,
                 fg=ACCENT, bg=PANEL).pack(anchor="w", **pad)
        slider_row = tk.Frame(parent, bg=PANEL)
        slider_row.pack(fill="x", padx=16)
        self._terms_var = tk.IntVar(value=8)
        self._terms_lbl = tk.Label(slider_row, text="8", font=self.fnt_big,
                                   fg=GOLD, bg=PANEL, width=3)
        self._terms_lbl.pack(side="right")
        terms_slider = tk.Scale(slider_row, from_=1, to=20,
                                variable=self._terms_var, orient="horizontal",
                                bg=PANEL, fg=TXT, troughcolor=GLASS,
                                highlightthickness=0, bd=0,
                                sliderrelief="flat", activebackground=ACCENT,
                                sliderlength=26, width=12, showvalue=0,
                                command=lambda v: self._terms_lbl.config(text=v))
        terms_slider.pack(side="left", fill="x", expand=True)

        sep2 = tk.Frame(parent, bg=BORDER, height=1)
        sep2.pack(fill="x", padx=16, pady=12)

        # Speed
        tk.Label(parent, text="ANIMATION SPEED", font=self.fnt_small,
                 fg=ACCENT, bg=PANEL).pack(anchor="w", **pad)
        self._speed_var = tk.IntVar(value=600)
        self._speed_lbl = tk.Label(parent, text="600 ms / frame", font=self.fnt_label,
                                   fg=TXT, bg=PANEL)
        self._speed_lbl.pack(anchor="w", padx=16)
        speed_slider = tk.Scale(parent, from_=100, to=2000,
                                variable=self._speed_var, orient="horizontal",
                                bg=PANEL, fg=TXT, troughcolor=GLASS,
                                highlightthickness=0, bd=0,
                                sliderrelief="flat", activebackground=ACCENT2,
                                sliderlength=26, width=12, showvalue=0,
                                command=lambda v: self._speed_lbl.config(
                                    text=f"{int(float(v))} ms / frame"
                                ))
        speed_slider.pack(fill="x", padx=16, pady=(0, 8))

        # X range
        tk.Label(parent, text="X RANGE", font=self.fnt_small,
                 fg=ACCENT, bg=PANEL).pack(anchor="w", **pad)
        xrow = tk.Frame(parent, bg=PANEL)
        xrow.pack(fill="x", padx=16, pady=(0, 10))
        self._xmin_var = tk.DoubleVar(value=-4)
        self._xmax_var = tk.DoubleVar(value=4)
        for lbl, var in [("from", self._xmin_var), ("to", self._xmax_var)]:
            tk.Label(xrow, text=lbl, font=self.fnt_small,
                     fg=TXT_DIM, bg=PANEL).pack(side="left")
            tk.Entry(xrow, textvariable=var, font=self.fnt_mono,
                     bg=GLASS, fg=TEAL, insertbackground=TEAL,
                     bd=0, width=5,
                     highlightbackground=BORDER, highlightthickness=1
                     ).pack(side="left", padx=(2, 8))

        sep3 = tk.Frame(parent, bg=BORDER, height=1)
        sep3.pack(fill="x", padx=16, pady=8)

        # Buttons
        self._animate_btn = tk.Button(
            parent, text="▶  ANIMATE", font=self.fnt_big,
            bg=ACCENT, fg=TXT_DARK, activebackground="#5a4de0",
            activeforeground=TXT_DARK, disabledforeground="#3f33a3",
            bd=0, cursor="hand2",
            relief="flat", pady=10,
            highlightbackground=GLASS_EDGE, highlightthickness=1,
            command=self._on_animate)
        self._animate_btn.pack(fill="x", padx=16, pady=4)
        self._attach_button_animation(self._animate_btn, ACCENT, "#9f8bff", "#5a4de0")

        self._pause_btn = tk.Button(
            parent, text="⏸  PAUSE", font=self.fnt_big,
            bg=CARD_HI, fg=ACCENT2, activebackground=ACCENT2,
            activeforeground=TXT_DARK, disabledforeground="#9c5871",
            bd=0, cursor="hand2",
            relief="flat", pady=8,
            command=self._on_pause_resume,
            highlightbackground=GLASS_EDGE, highlightthickness=1)
        self._pause_btn.pack(fill="x", padx=16, pady=4)
        self._attach_button_animation(self._pause_btn, CARD_HI, "#3b4e79", ACCENT2)

        self._reset_btn = tk.Button(
            parent, text="↺  RESET", font=self.fnt_small,
            bg=CARD_HI, fg=TXT_DARK, activebackground=BORDER, activeforeground=TXT_DARK,
            disabledforeground="#52586f", bd=0, cursor="hand2", relief="flat", pady=6,
            highlightbackground=GLASS_EDGE, highlightthickness=1,
            command=self._on_reset)
        self._reset_btn.pack(fill="x", padx=16, pady=(0, 8))
        self._attach_button_animation(self._reset_btn, CARD_HI, "#3b4e79", BORDER)

        # Status label
        self._status_var = tk.StringVar(value="ready.")
        tk.Label(parent, textvariable=self._status_var,
                 font=self.fnt_small, fg=TEAL, bg=PANEL,
                 wraplength=260, justify="left").pack(padx=16, pady=4)

        # Term counter
        self._term_count_var = tk.StringVar(value="")
        tk.Label(parent, textvariable=self._term_count_var,
                 font=self.fnt_big, fg=GOLD, bg=PANEL
                 ).pack(padx=16, pady=2)

    # ── Plot Area ─────────────────────────────────────────────────────────────
    def _build_plot(self, parent):
        self._fig, self._ax = plt.subplots(figsize=(8.6, 5.4), dpi=200)
        self._fig.patch.set_facecolor(BG)
        self._style_axes(self._ax)

        self._canvas = FigureCanvasTkAgg(self._fig, master=parent)
        self._canvas.get_tk_widget().configure(bg=BG, highlightthickness=0)
        self._canvas.get_tk_widget().pack(fill="both", expand=True, pady=(0, 4))

        self._toolbar = NavigationToolbar2Tk(self._canvas, parent, pack_toolbar=False)
        self._toolbar.update()
        self._toolbar.pack(fill="x", pady=(0, 8))
        self._toolbar.configure(background=PANEL)
        for child in self._toolbar.winfo_children():
            try:
                child.configure(background=PANEL, foreground=TXT)
            except Exception:
                pass

    # ── Polynomial Display ─────────────────────────────────────────────────────
    def _build_poly_display(self, parent):
        poly_frame = tk.Frame(parent, bg=CARD,
                              highlightbackground=BORDER, highlightthickness=1)
        poly_frame.pack(fill="x", pady=(0, 4))
        tk.Label(poly_frame, text="TAYLOR POLYNOMIAL", font=self.fnt_small,
                 fg=ACCENT, bg=CARD).pack(anchor="w", padx=12, pady=(6, 0))
        self._poly_var = tk.StringVar(value="Enter a function and press ANIMATE ▶")
        self._poly_lbl = tk.Label(poly_frame, textvariable=self._poly_var,
                                  font=("Courier New", 10), fg=GOLD, bg=CARD,
                                  wraplength=920, justify="left",
                                  anchor="w")
        self._poly_lbl.pack(fill="x", padx=12, pady=(2, 8))

    # ── Helpers ───────────────────────────────────────────────────────────────
    @staticmethod
    def _hex_to_rgb(hex_color):
        value = hex_color.lstrip("#")
        return tuple(int(value[i:i+2], 16) for i in (0, 2, 4))

    @staticmethod
    def _rgb_to_hex(rgb):
        return "#{:02x}{:02x}{:02x}".format(
            max(0, min(255, int(rgb[0]))),
            max(0, min(255, int(rgb[1]))),
            max(0, min(255, int(rgb[2]))),
        )

    def _mix_color(self, c1, c2, t):
        a = self._hex_to_rgb(c1)
        b = self._hex_to_rgb(c2)
        blend = tuple(a[i] + (b[i] - a[i]) * t for i in range(3))
        return self._rgb_to_hex(blend)

    def _animate_button_to(self, button, target_color, steps=6, delay=14):
        current = button.cget("bg")
        if not current.startswith("#"):
            current = target_color

        def _step(i):
            if not button.winfo_exists():
                return
            t = i / steps
            button.configure(bg=self._mix_color(current, target_color, t))
            if i < steps:
                button.after(delay, lambda: _step(i + 1))

        _step(1)

    def _attach_button_animation(self, button, normal, hover, press):
        button.configure(bg=normal)
        button.bind("<Enter>", lambda e: self._animate_button_to(button, hover))
        button.bind("<Leave>", lambda e: self._animate_button_to(button, normal))
        button.bind("<ButtonPress-1>", lambda e: self._animate_button_to(button, press))

        def _release(event):
            target = hover if button.winfo_containing(event.x_root, event.y_root) == button else normal
            self._animate_button_to(button, target)
        button.bind("<ButtonRelease-1>", _release)

    def _format_factorial_polynomial(self, expr, center, n_terms):
        terms = []
        a = sp.nsimplify(center)
        shift = "x" if sp.simplify(a) == 0 else f"(x-({sp.sstr(a)}))"
        for k in range(max(1, n_terms)):
            deriv = sp.simplify(sp.diff(expr, x, k).subs(x, a))
            if deriv == 0:
                continue
            if k == 0:
                terms.append(sp.sstr(deriv))
                continue
            power = shift if k == 1 else f"{shift}^{k}"
            terms.append(f"({sp.sstr(deriv)})*{power}/{k}!")
        if not terms:
            terms = ["0"]
        poly = " + ".join(terms).replace("+ -", "- ")
        return f"P_{n_terms}(x) = {poly}"

    def _style_axes(self, ax):
        ax.set_facecolor(CARD)
        ax.tick_params(colors=TXT_DIM, labelsize=8)
        for spine in ax.spines.values():
            spine.set_visible(False)
        ax.grid(True, color=BORDER, linewidth=0.65, linestyle="--", alpha=0.45)
        ax.minorticks_on()
        ax.grid(which="minor", color=BORDER, linewidth=0.35, alpha=0.25)
        ax.set_xlabel("x", color=TXT_DIM, fontsize=10)
        ax.set_ylabel("f(x)", color=TXT_DIM, fontsize=10)
        rounded_border = mpatches.FancyBboxPatch(
            (0, 0), 1, 1, transform=ax.transAxes,
            boxstyle="round,pad=0.015,rounding_size=0.04",
            linewidth=1.2, edgecolor=GLASS_EDGE, facecolor="none",
            clip_on=False, zorder=20
        )
        ax.add_patch(rounded_border)

    def _set_preset(self, expr_str):
        self._eq_var.set(expr_str)
        self._status_var.set(f"preset: {expr_str}")
        self._hide_suggestions()

    def _collect_suggestions(self, query):
        norm = query.strip().lower()
        if not norm:
            return FUNCTION_HINTS[:7]
        options = list(dict.fromkeys(FUNCTION_HINTS + list(PRESETS.values())))
        starts = [item for item in options if item.lower().startswith(norm)]
        contains = [item for item in options
                    if norm in item.lower() and item not in starts]
        return (starts + contains)[:7]

    def _show_suggestions(self):
        if not self._autocomplete_items:
            self._hide_suggestions()
            return
        self._suggestions.delete(0, tk.END)
        for item in self._autocomplete_items:
            self._suggestions.insert(tk.END, item)
        self._suggestions.selection_clear(0, tk.END)
        self._selected_suggestion_idx = 0
        self._suggestions.selection_set(0)
        self._suggestions.activate(0)
        if not self._autocomplete_visible:
            self._suggestions.pack(fill="x")
        self._autocomplete_visible = True

    def _hide_suggestions(self, event=None):
        if self._autocomplete_visible:
            self._suggestions.pack_forget()
        self._autocomplete_visible = False
        self._selected_suggestion_idx = -1
        return "break" if event is not None else None

    def _hide_suggestions_delayed(self, event=None):
        self.after(120, self._hide_suggestions)

    def _on_eq_keyrelease(self, event=None):
        if event is not None and event.keysym in {"Down", "Up", "Return", "Tab", "Escape"}:
            return
        value = self._eq_var.get()
        self._autocomplete_items = self._collect_suggestions(value)
        if value.strip() and self._autocomplete_items:
            self._show_suggestions()
        else:
            self._hide_suggestions()

    def _suggestion_down(self, event=None):
        if not self._autocomplete_visible:
            self._autocomplete_items = self._collect_suggestions(self._eq_var.get())
            self._show_suggestions()
        if not self._autocomplete_items:
            return "break"
        self._selected_suggestion_idx = min(
            self._selected_suggestion_idx + 1,
            len(self._autocomplete_items) - 1
        )
        self._suggestions.selection_clear(0, tk.END)
        self._suggestions.selection_set(self._selected_suggestion_idx)
        self._suggestions.activate(self._selected_suggestion_idx)
        return "break"

    def _suggestion_up(self, event=None):
        if not self._autocomplete_visible or not self._autocomplete_items:
            return "break"
        self._selected_suggestion_idx = max(self._selected_suggestion_idx - 1, 0)
        self._suggestions.selection_clear(0, tk.END)
        self._suggestions.selection_set(self._selected_suggestion_idx)
        self._suggestions.activate(self._selected_suggestion_idx)
        return "break"

    def _accept_suggestion(self):
        if not self._autocomplete_items:
            return
        idx = self._selected_suggestion_idx if self._selected_suggestion_idx >= 0 else 0
        idx = min(idx, len(self._autocomplete_items) - 1)
        self._eq_var.set(self._autocomplete_items[idx])
        self._hide_suggestions()
        self._eq_entry.icursor(tk.END)

    def _suggestion_accept_from_entry(self, event=None):
        if self._autocomplete_visible:
            self._accept_suggestion()
            return "break"
        return None

    def _suggestion_accept_from_list(self, event=None):
        sel = self._suggestions.curselection()
        if sel:
            self._selected_suggestion_idx = sel[0]
        self._accept_suggestion()
        return "break"

    def _on_stop(self):
        self._anim_running = False
        self._anim_paused = False
        if self._anim:
            event_source = getattr(self._anim, "event_source", None)
            if event_source is not None:
                event_source.stop()
            self._anim = None
        self._status_var.set("stopped.")
        self._animate_btn.config(state="normal")
        self._pause_btn.config(text="⏸  PAUSE")

    def _on_pause_resume(self):
        if not self._anim_running or not self._anim:
            self._status_var.set("nothing to pause. press ANIMATE first.")
            return

        if self._anim_paused:
            event_source = getattr(self._anim, "event_source", None)
            if event_source is None:
                self._anim_running = False
                self._anim_paused = False
                self._pause_btn.config(text="⏸  PAUSE")
                self._status_var.set("animation ended. press ANIMATE.")
                return
            event_source.start()
            self._anim_paused = False
            self._pause_btn.config(text="⏸  PAUSE")
            self._status_var.set("resumed.")
        else:
            event_source = getattr(self._anim, "event_source", None)
            if event_source is None:
                self._anim_running = False
                self._status_var.set("animation ended. press ANIMATE.")
                return
            event_source.stop()
            self._anim_paused = True
            self._pause_btn.config(text="▶  RESUME")
            self._status_var.set("paused.")

    def _on_reset(self):
        self._on_stop()
        self._ax.cla()
        self._style_axes(self._ax)
        self._canvas.draw_idle()
        self._poly_var.set("Enter a function and press ANIMATE ▶")
        self._header_poly_var.set("P_n(x) = f(a) + f'(a)(x-a)/1! + f''(a)(x-a)^2/2! + ...")
        self._term_count_var.set("")
        self._status_var.set("reset.")

    # ── Main Animate ──────────────────────────────────────────────────────────
    def _on_animate(self):
        if self._anim_running:
            self._on_stop()
            self._status_var.set("restarting animation…")

        expr_str = self._eq_var.get().strip()
        if not expr_str:
            messagebox.showwarning("Input", "Please enter a function.")
            return

        try:
            self._center = float(self._center_var.get())
            xmin = float(self._xmin_var.get())
            xmax = float(self._xmax_var.get())
            if xmin >= xmax:
                raise ValueError("xmin must be < xmax")
            self._x_range = (xmin, xmax)
        except ValueError as e:
            messagebox.showerror("Range Error", str(e))
            return

        self._status_var.set("computing series…")
        self._hide_suggestions()
        self.update_idletasks()

        # Parse + compute in background
        threading.Thread(target=self._compute_and_animate,
                         args=(expr_str,), daemon=True).start()

    def _compute_and_animate(self, expr_str):
        try:
            expr = parse_expr(expr_str)
            n    = self._terms_var.get()
            center = self._center

            terms, full_poly = get_taylor_terms(expr, center=center, n_terms=n)
            if not terms:
                self.after(0, lambda: messagebox.showerror(
                    "Error", "Could not compute Taylor series for this function."))
                return

            self._terms     = terms
            self._full_poly = full_poly
            poly_display = self._format_factorial_polynomial(expr, center, n)
            header_display = poly_display
            if len(header_display) > 180:
                header_display = header_display[:177] + "..."

            self.after(0, lambda: self._start_animation(
                expr, terms, poly_display, header_display
            ))
        except Exception as e:
            self.after(0, lambda err=str(e): messagebox.showerror(
                "Computation Error", f"Could not process: {err}"))
            self.after(0, lambda: self._status_var.set("error. check input."))

    def _start_animation(self, expr, terms, poly_display, header_display):
        self._poly_var.set(poly_display)
        self._header_poly_var.set(header_display)

        xmin, xmax = self._x_range
        x_vals = np.linspace(xmin, xmax, 1400)

        # True function
        y_true = safe_eval(expr, x_vals)

        # Pre-compute all approximation y-values
        y_approx_list = [safe_eval(t, x_vals) for t in terms]

        # ── Clear axes ────────────────────────────────────────────────────────
        ax = self._ax
        ax.cla()
        self._style_axes(ax)
        ax.set_xlim(xmin, xmax)

        # Y limits: use true function range + some padding
        valid_y = y_true[np.isfinite(y_true)]
        if len(valid_y):
            yc  = np.median(valid_y)
            yr  = max(np.percentile(np.abs(valid_y - yc), 95), 1) * 1.6
            ax.set_ylim(yc - yr, yc + yr)
        else:
            ax.set_ylim(-10, 10)

        # True function line
        (line_true,) = ax.plot(x_vals, y_true, color=TEAL, lw=2.3,
                               label="f(x)", zorder=4, alpha=0.72)

        # Center marker
        ax.axvline(self._center, color=TXT_DIM, lw=0.8, linestyle=":", alpha=0.5)
        ax.text(self._center + 0.05, ax.get_ylim()[1] * 0.92,
                f"a={self._center}", color=TXT_DIM,
                fontsize=8, fontfamily="Courier New")

        # Approximation line (will be updated)
        (line_approx,) = ax.plot([], [], color=DARK_GRAD_COLS[0], lw=3.0,
                                  linestyle="-", label="Taylor P₁(x)", zorder=8)

        # Legend placeholder
        leg = ax.legend(loc="upper right", facecolor=CARD, edgecolor=BORDER,
                        labelcolor=TXT, fontsize=9)

        title_obj = ax.set_title("", color=TXT, fontsize=10,
                                  fontfamily="Courier New", pad=8)

        frame_count = [0]
        n_terms = len(terms)
        if n_terms == 1:
            y_approx_interp = [y_approx_list[0]]
            term_progress = [0.0]
            term_anchor = [0]
        else:
            # Smooth animation: transition each Taylor term in many eased sub-frames.
            frame_interval = 16  # ~60fps target
            speed_ms = max(80, int(self._speed_var.get()))
            subframes = max(6, speed_ms // frame_interval)
            y_approx_interp = []
            term_progress = []
            term_anchor = []
            for i in range(n_terms - 1):
                y0 = y_approx_list[i]
                y1 = y_approx_list[i + 1]
                for j in range(subframes):
                    t = j / subframes
                    # Gravity-like curve: accelerate then ease into attachment.
                    if t < 0.72:
                        eased = (t / 0.72) ** 2 * 0.82
                    else:
                        tail = (t - 0.72) / 0.28
                        eased = 0.82 + (1 - (1 - tail) ** 3) * 0.18
                    y_approx_interp.append((1 - eased) * y0 + eased * y1)
                    term_progress.append(eased)
                    term_anchor.append(i)
            y_approx_interp.append(y_approx_list[-1])
            term_progress.append(1.0)
            term_anchor.append(n_terms - 1)
        n_frames = len(y_approx_interp)

        def _update(frame_idx):
            idx = min(frame_idx, n_frames - 1)
            y_app = y_approx_interp[idx]
            anchor_idx = term_anchor[idx]
            prog = term_progress[idx]
            display_term = min(anchor_idx + 1 + int(prog >= 0.999), n_terms)
            col = DARK_GRAD_COLS[(display_term - 1) % len(DARK_GRAD_COLS)]

            line_approx.set_data(x_vals, y_app)
            line_approx.set_color(col)
            line_approx.set_label(f"P_{display_term}(x)")

            # Update legend
            patches = [
                mpatches.Patch(color=TEAL, label="f(x)  ← true"),
                mpatches.Patch(color=col,  label=f"P_{display_term}(x)  ← approx"),
            ]
            ax.legend(handles=patches, loc="upper right",
                      facecolor=CARD, edgecolor=BORDER,
                      labelcolor=TXT, fontsize=9)

            if display_term < n_terms:
                title_obj.set_text(
                    f"Taylor approximation  |  attaching term {display_term + 1} of {n_terms}"
                )
            else:
                title_obj.set_text(f"Taylor approximation  |  term {n_terms} of {n_terms}")

            self._term_count_var.set(f"term {display_term} / {n_terms}")
            self._status_var.set(f"animating… term {display_term}")

            if idx >= n_frames - 1:
                self._anim_running = False
                self._anim_paused = False
                self._animate_btn.config(state="normal")
                self._pause_btn.config(text="⏸  PAUSE")
                self._status_var.set("animation complete.")

            frame_count[0] += 1
            return line_approx, line_true

        self._anim = FuncAnimation(
            self._fig, _update,
            frames=n_frames,
            interval=16,
            blit=False,
            repeat=False
        )

        self._anim_running = True
        self._anim_paused = False
        self._animate_btn.config(state="disabled")
        self._pause_btn.config(text="⏸  PAUSE")
        self._canvas.draw_idle()
        self._status_var.set("animating ▶  press PAUSE to hold.")


# ══════════════════════════════════════════════════════════════════════════════
if __name__ == "__main__":
    app = TaylorApp()
    app.mainloop()