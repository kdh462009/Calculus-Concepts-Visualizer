#!/usr/bin/env python3
"""Calc BC visualizer hub — launcher and navigation shell."""

from __future__ import annotations

import threading

import webview

from graph import resolve_resource
from taylor import TaylorApi

VISUALIZERS = [
    {
        "id": "taylor",
        "title": "Taylor Series",
        "subtitle": "Animated polynomial approximations around a center point",
        "symbol": "∑",
        "path": "ui/taylor/index.html",
    },
]


class AppApi:
    def __init__(self):
        self._window = None
        self._taylor = TaylorApi()

    def bind_window(self, window) -> None:
        self._window = window

    def _schedule_url(self, url: str) -> None:
        """Defer navigation so pywebview can resolve the JS callback first."""
        def _navigate() -> None:
            if self._window:
                self._window.load_url(url)

        threading.Timer(0.12, _navigate).start()

    def get_visualizers(self):
        return [
            {k: v for k, v in item.items() if k != "path"}
            for item in VISUALIZERS
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

    def get_bootstrap(self):
        return self._taylor.get_bootstrap()

    def compute(self, payload):
        return self._taylor.compute(payload)


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
