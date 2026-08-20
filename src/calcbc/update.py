"""Non-invasive update check via GitHub Releases.

The app never downloads or replaces itself — it only compares versions and
opens the official release asset URL in the system browser.
"""

from __future__ import annotations

import json
import platform
import re
import ssl
import urllib.error
import urllib.request
from typing import Any

from calcbc import __version__

GITHUB_OWNER = "kdh462009"
GITHUB_REPO = "Calculus-Concepts-Visualizer"
RELEASES_API = (
    f"https://api.github.com/repos/{GITHUB_OWNER}/{GITHUB_REPO}/releases/latest"
)
RELEASES_PAGE = f"https://github.com/{GITHUB_OWNER}/{GITHUB_REPO}/releases/latest"
USER_AGENT = f"CalcBCVisualizers/{__version__} (+https://github.com/{GITHUB_OWNER}/{GITHUB_REPO})"
REQUEST_TIMEOUT_S = 6.0


def current_version() -> str:
    return str(__version__).strip()


def normalize_version(raw: str | None) -> tuple[int, ...]:
    """Turn 'v1.4.0' / '1.3' into a comparable tuple of ints."""
    text = str(raw or "").strip().lstrip("vV")
    if not text:
        return (0,)
    parts: list[int] = []
    for chunk in re.split(r"[.\-+_]", text):
        if not chunk:
            continue
        m = re.match(r"^(\d+)", chunk)
        if m:
            parts.append(int(m.group(1)))
        else:
            break
    return tuple(parts) if parts else (0,)


def is_newer(latest: str, current: str) -> bool:
    a = list(normalize_version(latest))
    b = list(normalize_version(current))
    n = max(len(a), len(b), 1)
    a.extend([0] * (n - len(a)))
    b.extend([0] * (n - len(b)))
    return tuple(a) > tuple(b)


def platform_key() -> str:
    system = platform.system().lower()
    if system == "darwin":
        return "macos"
    if system == "windows":
        return "windows"
    return "other"


def _asset_score(name: str, key: str) -> int:
    lower = name.lower()
    if key == "macos":
        if lower.endswith(".dmg"):
            return 100
        if "macos" in lower and lower.endswith(".zip"):
            return 90
        if lower.endswith(".zip") and "windows" not in lower and "win" not in lower:
            return 40
        return -1
    if key == "windows":
        if "windows" in lower and lower.endswith(".zip"):
            return 100
        if lower.endswith(".exe"):
            return 95
        if "win" in lower and lower.endswith(".zip"):
            return 85
        if lower.endswith(".zip") and "macos" not in lower and "darwin" not in lower:
            return 40
        return -1
    return -1


def pick_download_url(assets: list[dict[str, Any]], key: str) -> str | None:
    best_url = None
    best_score = -1
    for asset in assets or []:
        name = str(asset.get("name") or "")
        url = str(asset.get("browser_download_url") or "").strip()
        if not url:
            continue
        score = _asset_score(name, key)
        if score > best_score:
            best_score = score
            best_url = url
    return best_url


def is_allowed_download_url(url: str) -> bool:
    """Only allow official GitHub release / repo URLs for this project."""
    prefix_asset = (
        f"https://github.com/{GITHUB_OWNER}/{GITHUB_REPO}/releases/download/"
    )
    prefix_tag = f"https://github.com/{GITHUB_OWNER}/{GITHUB_REPO}/releases/tag/"
    prefix_latest = f"https://github.com/{GITHUB_OWNER}/{GITHUB_REPO}/releases/latest"
    return (
        url.startswith(prefix_asset)
        or url.startswith(prefix_tag)
        or url == prefix_latest
        or url.startswith(prefix_latest + "?")
    )


def replace_instructions(key: str | None = None) -> str:
    key = key or platform_key()
    if key == "macos":
        return (
            "Download the new app (or DMG), then replace the existing "
            "CalcBCVisualizers.app with the downloaded version."
        )
    if key == "windows":
        return (
            "Download the new zip, close Calc BC Visualizers, then replace the "
            "existing CalcBCVisualizers.exe (and folder) with the downloaded version."
        )
    return "Download the latest release for your platform and replace this installation."


def _ssl_context() -> ssl.SSLContext:
    """Prefer certifi's CA bundle (needed on many macOS Python installs)."""
    try:
        import certifi

        return ssl.create_default_context(cafile=certifi.where())
    except Exception:
        return ssl.create_default_context()


def _fetch_latest_release() -> dict[str, Any] | None:
    req = urllib.request.Request(
        RELEASES_API,
        headers={
            "Accept": "application/vnd.github+json",
            "User-Agent": USER_AGENT,
            "X-GitHub-Api-Version": "2022-11-28",
        },
        method="GET",
    )
    with urllib.request.urlopen(
        req, timeout=REQUEST_TIMEOUT_S, context=_ssl_context()
    ) as resp:
        raw = resp.read().decode("utf-8", errors="replace")
    data = json.loads(raw)
    return data if isinstance(data, dict) else None


def check_for_update() -> dict[str, Any]:
    """
    Compare the running app to the latest GitHub release.

    Failures (offline, API errors, no releases) return update=False with
    checked=False so the UI can stay quiet on auto-check but still give
    feedback on a manual check.
    """
    current = current_version()
    base = {
        "ok": True,
        "update": False,
        "checked": False,
        "currentVersion": current,
        "platform": platform_key(),
    }
    try:
        release = _fetch_latest_release()
        if not release:
            return base
        tag = str(release.get("tag_name") or release.get("name") or "").strip()
        if not tag:
            return base

        latest_display = tag[1:] if tag[:1] in "vV" else tag
        if not is_newer(tag, current):
            return {
                **base,
                "checked": True,
                "latestVersion": latest_display,
            }

        key = platform_key()
        assets = release.get("assets") if isinstance(release.get("assets"), list) else []
        download_url = pick_download_url(assets, key) or RELEASES_PAGE
        if not is_allowed_download_url(download_url):
            download_url = RELEASES_PAGE

        return {
            "ok": True,
            "update": True,
            "checked": True,
            "currentVersion": current,
            "latestVersion": latest_display,
            "latestTag": tag,
            "platform": key,
            "downloadUrl": download_url,
            "releaseUrl": str(release.get("html_url") or RELEASES_PAGE),
            "instructions": replace_instructions(key),
        }
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError, ValueError, json.JSONDecodeError):
        return base
    except Exception:
        return base


def open_download(url: str | None = None) -> dict[str, Any]:
    """Open a validated GitHub release download URL in the system browser."""
    import webbrowser

    target = str(url or "").strip() or RELEASES_PAGE
    if not is_allowed_download_url(target):
        return {"ok": False, "error": "URL not allowed."}
    webbrowser.open(target)
    return {"ok": True, "url": target}
