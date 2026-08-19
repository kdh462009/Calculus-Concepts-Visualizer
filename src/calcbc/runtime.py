"""Frozen-app startup helpers (Windows download/MOTW, GUI backend)."""

from __future__ import annotations

import os
import sys
from pathlib import Path

_BINARY_SUFFIXES = {".dll", ".exe", ".pyd"}


def clear_windows_download_block() -> None:
    """Remove NTFS Zone.Identifier streams from packaged binaries.

    Zips downloaded from the internet inherit Mark of the Web. .NET then
    refuses to load pythonnet's Python.Runtime.dll, which pywebview needs
    on Windows. Local builds are unaffected because they are not blocked.
    """
    if sys.platform != "win32" or not getattr(sys, "frozen", False):
        return

    roots: list[Path] = []
    meipass = getattr(sys, "_MEIPASS", None)
    if meipass:
        roots.append(Path(meipass))
    roots.append(Path(sys.executable).resolve().parent)

    seen: set[Path] = set()
    for root in roots:
        try:
            resolved = root.resolve()
        except OSError:
            continue
        if resolved in seen or not resolved.is_dir():
            continue
        seen.add(resolved)
        for path in resolved.rglob("*"):
            if not path.is_file() or path.suffix.lower() not in _BINARY_SUFFIXES:
                continue
            ads = f"{path}:Zone.Identifier"
            try:
                os.remove(ads)
            except OSError:
                pass


def _windows_startup_error(exc: BaseException) -> None:
    message = (
        "Concept Visualizers could not open a window.\n\n"
        f"{exc}\n\n"
        "If you downloaded this zip from the internet: right-click the zip, "
        "choose Properties, check Unblock, Apply, then unzip again.\n\n"
        "Windows 10/11 also needs Microsoft Edge WebView2 Runtime."
    )
    try:
        import ctypes

        ctypes.windll.user32.MessageBoxW(None, message, "Concept Visualizers", 0x10)
    except Exception:
        pass


def start_webview(**kwargs) -> None:
    """Start pywebview after clearing Windows download blocks on packaged DLLs."""
    import webview

    clear_windows_download_block()
    try:
        webview.start(**kwargs)
    except Exception as exc:
        if sys.platform == "win32":
            _windows_startup_error(exc)
        raise
