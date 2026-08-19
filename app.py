#!/usr/bin/env python3
"""Calc BC visualizer hub — launcher and navigation shell."""

from __future__ import annotations

import threading
import webbrowser

import webview

from derivatives import DerivativesApi
from graph import compute_function_preview, resolve_resource
from limit import LimitApi
from inverse import InverseApi
from riemann import RiemannApi
from taylor import TaylorApi
from volume_rotation import VolumeRotationApi
from Parametric import ParametricApi
from polar import PolarApi

VISUALIZERS = [
    {
        "id": "limit",
        "unit": 1,
        "unitTitle": "Limits & Continuity",
        "title": "Limits (Epsilon-Delta)",
        "subtitle": "Animate shrinking epsilon bands and delta neighborhoods to visualize convergence",
        "symbol": "εδ",
        "path": "ui/limit/index.html",
    },
    {
        "id": "derivatives",
        "unit": 2,
        "unitTitle": "Differentiation Fundamentals",
        "title": "Derivatives",
        "subtitle": "Animate tangent slope, first derivative, and second-derivative concavity",
        "symbol": "f′",
        "path": "ui/derivatives/index.html",
    },
    {
        "id": "inverse",
        "unit": 3,
        "unitTitle": "Composite, Implicit & Inverse Functions",
        "title": "Inverse Visualizer",
        "subtitle": "Animate f(x), f⁻¹(x), and derivative relationships on a shared view",
        "symbol": "f⁻¹",
        "path": "ui/inverse/index.html",
    },
    {
        "id": "riemann",
        "unit": 6,
        "unitTitle": "Integration & Accumulation",
        "title": "Riemann Sums",
        "subtitle": "Compare left/right/mid/trapezoid sums against the definite integral",
        "symbol": "∫",
        "path": "ui/riemann/index.html",
    },
    {
        "id": "volume_rotation",
        "unit": 8,
        "unitTitle": "Applications of Integration",
        "title": "Volume Rotation",
        "subtitle": "Rotate bounded regions around an axis to visualize solids of revolution",
        "symbol": "⟳V",
        "path": "ui/volume_rotation/index.html",
    },
    {
        "id": "parametric",
        "unit": 9,
        "unitTitle": "Parametric, Polar & Vector-Valued Functions",
        "title": "Parametric Curves",
        "subtitle": "Animate x(t), y(t), velocity, and motion vectors",
        "symbol": "(x,y)",
        "path": "ui/parametric/index.html",
    },
    {
        "id": "polar",
        "unit": 9,
        "unitTitle": "Parametric, Polar & Vector-Valued Functions",
        "title": "Polar Area",
        "subtitle": "Shade polar regions with sector slices and compare two curves",
        "symbol": "rθ",
        "path": "ui/polar/index.html",
    },
    {
        "id": "taylor",
        "unit": 10,
        "unitTitle": "Infinite Sequences & Series",
        "title": "Taylor Series",
        "subtitle": "Animated polynomial approximations around a center point",
        "symbol": "∑",
        "path": "ui/taylor/index.html",
    },
]


EXTERNAL_URLS = frozenset(
    {
        "https://creativecommons.org/licenses/by-nc-sa/4.0/deed.en",
        "https://creativecommons.org/licenses/by-nc-sa/4.0/",
        "https://github.com/kdh462009/Calculus-Concepts-Visualizer",
        "https://knivier.com/tos-ssp.html",
    }
)


class AppApi:
    def __init__(self):
        self._window = None
        self._taylor = TaylorApi()
        self._riemann = RiemannApi()
        self._derivatives = DerivativesApi()
        self._volume_rotation = VolumeRotationApi()
        self._limit = LimitApi()
        self._inverse = InverseApi()
        self._parametric = ParametricApi()
        self._polar = PolarApi()

    def bind_window(self, window) -> None:
        self._window = window

    def _schedule_url(self, url: str) -> None:
        """Defer navigation so pywebview can resolve the JS callback first."""
        def _navigate() -> None:
            if self._window:
                self._window.load_url(url)

        threading.Timer(0.12, _navigate).start()

    def get_visualizers(self):
        items = sorted(VISUALIZERS, key=lambda item: (item["unit"], item["title"]))
        return [
            {k: v for k, v in item.items() if k != "path"}
            for item in items
        ]

    def open_visualizer(self, visualizer_id: str):
        if not self._window:
            return {"ok": False, "error": "Window not ready."}
        for item in VISUALIZERS:
            if item["id"] == visualizer_id:
                url = resolve_resource(item["path"]).as_uri()
                self._schedule_url(url)
                return {"ok": True}
        return {"ok": False, "error": f"Unknown visualizer: {visualizer_id}"}

    def go_home(self):
        if not self._window:
            return {"ok": False, "error": "Window not ready."}
        url = resolve_resource("ui/home/index.html").as_uri()
        self._schedule_url(url)
        return {"ok": True}

    def open_external(self, url: str):
        target = str(url or "").strip()
        if target not in EXTERNAL_URLS:
            return {"ok": False, "error": "URL not allowed."}
        webbrowser.open(target)
        return {"ok": True}

    def get_bootstrap(self):
        return self._taylor.get_bootstrap()

    def compute(self, payload):
        return self._taylor.compute(payload)

    def get_riemann_bootstrap(self):
        return self._riemann.get_bootstrap()

    def compute_riemann(self, payload):
        return self._riemann.compute(payload)

    def get_derivatives_bootstrap(self):
        return self._derivatives.get_bootstrap()

    def compute_derivatives(self, payload):
        return self._derivatives.compute(payload)

    def preview_function(self, payload):
        return compute_function_preview(payload)

    def get_volume_bootstrap(self):
        return self._volume_rotation.get_bootstrap()

    def compute_volume(self, payload):
        return self._volume_rotation.compute(payload)

    def get_limit_bootstrap(self):
        return self._limit.get_bootstrap()

    def compute_limit(self, payload):
        return self._limit.compute(payload)

    def get_inverse_bootstrap(self):
        return self._inverse.get_bootstrap()

    def compute_inverse(self, payload):
        return self._inverse.compute(payload)

    def get_parametric_bootstrap(self):
        return self._parametric.get_bootstrap()

    def compute_parametric(self, payload):
        return self._parametric.compute(payload)

    def get_polar_bootstrap(self):
        return self._polar.get_bootstrap()

    def compute_polar(self, payload):
        return self._polar.compute(payload)


def main():
    api = AppApi()
    window = webview.create_window(
        title="Calc BC Visualizers",
        url=resolve_resource("ui/home/index.html").as_uri(),
        js_api=api,
        width=1320,
        height=860,
        min_size=(1000, 680),
        background_color="#0a1020",
    )
    api.bind_window(window)
    webview.start(debug=False)


if __name__ == "__main__":
    main()
