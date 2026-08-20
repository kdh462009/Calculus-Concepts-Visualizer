#!/usr/bin/env python3
"""Calc BC visualizer hub - launcher and navigation shell."""

from __future__ import annotations

import threading
import webbrowser

import webview

from calcbc.visualizers.derivatives import DerivativesApi
from calcbc.graph import compute_function_preview, resolve_resource
from calcbc.catalog import find_visualizer, get_catalog as build_catalog
from calcbc.visualizers.limit import LimitApi
from calcbc.visualizers.inverse import InverseApi
from calcbc.visualizers.arc_length import ArcLengthApi
from calcbc.visualizers.riemann import RiemannApi
from calcbc.visualizers.slope_field import SlopeFieldApi
from calcbc.visualizers.taylor import TaylorApi
from calcbc.visualizers.volume_rotation import VolumeRotationApi
from calcbc.visualizers.parametric import ParametricApi
from calcbc.runtime import start_webview
from calcbc.visualizers.polar import PolarApi
from calcbc.visualizers.fourier import FourierApi
from calcbc.visualizers.monte_carlo import MonteCarloApi
from calcbc import __version__
from calcbc import update as app_update


EXTERNAL_URLS = frozenset(
    {
        "https://creativecommons.org/licenses/by-nc-sa/4.0/deed.en",
        "https://creativecommons.org/licenses/by-nc-sa/4.0/",
        "https://github.com/kdh462009/Calculus-Concepts-Visualizer",
        "https://github.com/kdh462009/Calculus-Concepts-Visualizer/releases/latest",
        "https://knivier.com/tos-ssp.html",
    }
)


class AppApi:
    def __init__(self):
        self._window = None
        self._nav_lock = threading.Lock()
        self._nav_pending = False
        self._taylor = TaylorApi()
        self._riemann = RiemannApi()
        self._arc_length = ArcLengthApi()
        self._slope_field = SlopeFieldApi()
        self._derivatives = DerivativesApi()
        self._volume_rotation = VolumeRotationApi()
        self._limit = LimitApi()
        self._inverse = InverseApi()
        self._parametric = ParametricApi()
        self._polar = PolarApi()
        self._fourier = FourierApi()
        self._monte_carlo = MonteCarloApi()

    def bind_window(self, window) -> None:
        self._window = window
        original_evaluate_js = window.evaluate_js

        def safe_evaluate_js(*args, **kwargs):
            try:
                return original_evaluate_js(*args, **kwargs)
            except Exception as exc:
                text = str(exc)
                if "_returnValuesCallbacks" in text:
                    return None
                raise

        window.evaluate_js = safe_evaluate_js

    def _unlock_js_nav(self) -> None:
        window = self._window
        if not window:
            return
        try:
            window.evaluate_js(
                "try{"
                "if(window.VizTransition&&typeof window.VizTransition.abortNavigation==='function')"
                "{window.VizTransition.abortNavigation();}"
                "else{window.__vizNavigating=false;}"
                "}catch(e){}"
            )
        except Exception:
            pass

    def _schedule_url(self, url: str) -> bool:
        """Defer navigation so pywebview can resolve the JS callback first."""
        with self._nav_lock:
            if self._nav_pending:
                return False
            self._nav_pending = True

        def _navigate() -> None:
            failed = False
            try:
                if self._window:
                    self._window.load_url(url)
                else:
                    failed = True
            except Exception:
                failed = True
            finally:
                with self._nav_lock:
                    self._nav_pending = False
            if failed:
                self._unlock_js_nav()

        threading.Timer(0.12, _navigate).start()
        return True

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
        if not self._schedule_url(url):
            return {"ok": False, "error": "Navigation already in progress."}
        return {"ok": True}

    def go_home(self):
        if not self._window:
            return {"ok": False, "error": "Window not ready."}
        url = resolve_resource("ui/home/index.html").as_uri()
        if not self._schedule_url(url):
            return {"ok": False, "error": "Navigation already in progress."}
        return {"ok": True}

    def open_external(self, url: str):
        target = str(url or "").strip()
        if target not in EXTERNAL_URLS and not app_update.is_allowed_download_url(target):
            return {"ok": False, "error": "URL not allowed."}
        webbrowser.open(target)
        return {"ok": True}

    def check_for_update(self):
        return app_update.check_for_update()

    def open_update_download(self, url: str = ""):
        return app_update.open_download(url)

    def get_app_version(self):
        return {
            "ok": True,
            "version": __version__,
            "changelogUrl": app_update.release_notes_url(__version__),
        }

    def open_changelog(self):
        return app_update.open_download(app_update.release_notes_url())

    def get_bootstrap(self):
        return self._taylor.get_bootstrap()

    def compute(self, payload):
        return self._taylor.compute(payload)

    def get_riemann_bootstrap(self):
        return self._riemann.get_bootstrap()

    def compute_riemann(self, payload):
        return self._riemann.compute(payload)

    def preview_riemann(self, payload):
        return self._riemann.preview(payload)

    def get_arc_length_bootstrap(self):
        return self._arc_length.get_bootstrap()

    def compute_arc_length(self, payload):
        return self._arc_length.compute(payload)

    def preview_arc_length(self, payload):
        return self._arc_length.preview(payload)

    def get_slope_field_bootstrap(self):
        return self._slope_field.get_bootstrap()

    def compute_slope_field(self, payload):
        return self._slope_field.compute(payload)

    def get_derivatives_bootstrap(self):
        return self._derivatives.get_bootstrap()

    def compute_derivatives(self, payload):
        return self._derivatives.compute(payload)

    def preview_derivatives(self, payload):
        return self._derivatives.preview(payload)

    def render_readout(self, payload):
        from calcbc.readouts import render_readout as build_readout_png

        return build_readout_png(payload)

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

    def get_fourier_bootstrap(self):
        return self._fourier.get_bootstrap()

    def get_fourier_preset(self, payload):
        return self._fourier.get_preset(payload)

    def compute_fourier(self, payload):
        return self._fourier.compute(payload)

    def get_monte_carlo_bootstrap(self):
        return self._monte_carlo.get_bootstrap()

    def compute_monte_carlo(self, payload):
        return self._monte_carlo.compute(payload)

    def preview_monte_carlo(self, payload):
        return self._monte_carlo.preview(payload)


def main():
    api = AppApi()
    window = webview.create_window(
        title=f"Concept Visualizers {__version__}",
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
