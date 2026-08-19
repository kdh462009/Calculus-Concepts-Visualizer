#!/usr/bin/env python3
"""Calc BC visualizer hub — launcher and navigation shell."""

from __future__ import annotations

import threading
import webbrowser

import webview

from calcbc.visualizers.derivatives import DerivativesApi
from calcbc.graph import compute_function_preview, resolve_resource
from calcbc.catalog import find_visualizer, get_catalog as build_catalog
from calcbc.visualizers.limit import LimitApi
from calcbc.visualizers.inverse import InverseApi
from calcbc.visualizers.riemann import RiemannApi
from calcbc.visualizers.taylor import TaylorApi
from calcbc.visualizers.volume_rotation import VolumeRotationApi
from calcbc.visualizers.parametric import ParametricApi
from calcbc.runtime import start_webview
from calcbc.visualizers.polar import PolarApi


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

    def get_catalog(self):
        return build_catalog()

    def get_visualizers(self):
        catalog = build_catalog()
        items = []
        for subject in catalog["subjects"]:
            items.extend(subject["visualizers"])
        return items

    def open_visualizer(self, visualizer_id: str):
        if not self._window:
            return {"ok": False, "error": "Window not ready."}
        item = find_visualizer(visualizer_id)
        if not item:
            return {"ok": False, "error": f"Unknown visualizer: {visualizer_id}"}
        url = resolve_resource(item["path"]).as_uri()
        self._schedule_url(url)
        return {"ok": True}

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
        title="Concept Visualizers 1.2",
        url=resolve_resource("ui/home/index.html").as_uri(),
        js_api=api,
        width=1320,
        height=860,
        min_size=(1000, 680),
        background_color="#0a1020",
    )
    api.bind_window(window)
    start_webview(debug=False)


if __name__ == "__main__":
    main()
