"""Non-invasive update check via GitHub Releases.

The app never downloads or replaces itself — it only compares versions and
opens the official release asset URL in the system browser.

Also enforces a six-month support window from this build's release date
(SSP coverage softlock).
"""

from __future__ import annotations

import calendar
import json
import platform
import re
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date
from typing import Any

from calcbc import __release_date__, __version__

GITHUB_OWNER = "kdh462009"
GITHUB_REPO = "Calculus-Concepts-Visualizer"
RELEASES_LATEST_API = (
    f"https://api.github.com/repos/{GITHUB_OWNER}/{GITHUB_REPO}/releases/latest"
)
RELEASES_LIST_API = (
    f"https://api.github.com/repos/{GITHUB_OWNER}/{GITHUB_REPO}/releases?per_page=50"
)
RELEASES_PAGE = f"https://github.com/{GITHUB_OWNER}/{GITHUB_REPO}/releases/latest"
RELEASES_ATOM = f"https://github.com/{GITHUB_OWNER}/{GITHUB_REPO}/releases.atom"
RELEASE_BY_TAG_API = (
    f"https://api.github.com/repos/{GITHUB_OWNER}/{GITHUB_REPO}/releases/tags/"
)
USER_AGENT = f"CalcBCVisualizers/{__version__} (+https://github.com/{GITHUB_OWNER}/{GITHUB_REPO})"
REQUEST_TIMEOUT_S = 8.0
SOURCE_ATTEMPTS = 2
RETRY_SLEEP_S = 0.2
SUPPORT_MONTHS = 6
SOFTLOCK_MESSAGE = (
    "This version is out of date and as a result from current SSP coverage, "
    "will result in limited functionality. It's recommended to update to the "
    "latest version due to security patches and important performance/feature updates"
)


def release_notes_url(version: str | None = None) -> str:
    """GitHub release page for this build's tag (falls back to /releases/latest)."""
    tag = str(version if version is not None else current_version()).strip()
    if not tag:
        return RELEASES_PAGE
    # Tags are published as 1.4.0 (no leading v) in this repo.
    tag = tag.lstrip("vV")
    return f"https://github.com/{GITHUB_OWNER}/{GITHUB_REPO}/releases/tag/{tag}"


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


def _add_months(start: date, months: int) -> date:
    month_index = start.month - 1 + months
    year = start.year + month_index // 12
    month = month_index % 12 + 1
    day = min(start.day, calendar.monthrange(year, month)[1])
    return date(year, month, day)


def build_release_date() -> date:
    return date.fromisoformat(str(__release_date__).strip())


def support_expires_on() -> date:
    return _add_months(build_release_date(), SUPPORT_MONTHS)


def check_support_status() -> dict[str, Any]:
    """Local six-month support window from this build's release date."""
    current = current_version()
    try:
        release = build_release_date()
        expires = support_expires_on()
        today = date.today()
        expired = today >= expires
        return {
            "ok": True,
            "expired": expired,
            "currentVersion": current,
            "releaseDate": release.isoformat(),
            "expiresOn": expires.isoformat(),
            "supportMonths": SUPPORT_MONTHS,
            "message": SOFTLOCK_MESSAGE if expired else "",
        }
    except Exception:
        return {
            "ok": False,
            "expired": False,
            "currentVersion": current,
            "releaseDate": "",
            "expiresOn": "",
            "supportMonths": SUPPORT_MONTHS,
            "message": "",
        }


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


def _ssl_contexts() -> list[ssl.SSLContext]:
    """certifi first (py2app/macOS), then the system store."""
    contexts: list[ssl.SSLContext] = []
    try:
        import certifi

        contexts.append(ssl.create_default_context(cafile=certifi.where()))
    except Exception:
        pass
    try:
        contexts.append(ssl.create_default_context())
    except Exception:
        pass
    return contexts or [ssl.create_default_context()]


def _http_get(url: str, *, accept: str) -> tuple[bytes, str]:
    """GET with SSL fallbacks and a short retry. Returns (body, final_url)."""
    headers = {
        "Accept": accept,
        "User-Agent": USER_AGENT,
        "X-GitHub-Api-Version": "2022-11-28",
    }
    last_error: Exception | None = None
    for ctx in _ssl_contexts():
        for attempt in range(SOURCE_ATTEMPTS):
            try:
                req = urllib.request.Request(url, headers=headers, method="GET")
                with urllib.request.urlopen(
                    req, timeout=REQUEST_TIMEOUT_S, context=ctx
                ) as resp:
                    code = int(resp.getcode() or 200)
                    if code >= 400:
                        raise urllib.error.HTTPError(
                            url, code, "HTTP error", resp.headers, None
                        )
                    body = resp.read()
                    final = str(getattr(resp, "geturl", lambda: url)() or url)
                    return body, final
            except Exception as exc:
                last_error = exc
                time.sleep(RETRY_SLEEP_S * (attempt + 1))
    if last_error:
        raise last_error
    raise OSError(f"GET failed: {url}")


def _github_get(url: str) -> Any:
    raw, _final = _http_get(url, accept="application/vnd.github+json")
    return json.loads(raw.decode("utf-8", errors="replace"))


def _release_tag(release: dict[str, Any]) -> str:
    return str(release.get("tag_name") or release.get("name") or "").strip()


def _pick_highest_version_release(releases: list[Any]) -> dict[str, Any] | None:
    """Choose the highest semver among published non-prerelease releases."""
    best: dict[str, Any] | None = None
    best_ver: tuple[int, ...] = (0,)
    for item in releases:
        if not isinstance(item, dict):
            continue
        if item.get("draft") or item.get("prerelease"):
            continue
        tag = _release_tag(item)
        if not tag:
            continue
        ver = normalize_version(tag)
        if best is None or ver > best_ver:
            best = item
            best_ver = ver
    return best


def _minimal_release(tag: str, html_url: str = "") -> dict[str, Any]:
    tag = str(tag).strip()
    page = html_url.strip() or release_notes_url(tag)
    return {"tag_name": tag, "name": tag, "html_url": page, "assets": []}


def _tags_from_text(text: str) -> list[str]:
    found: list[str] = []
    seen: set[str] = set()
    for match in re.finditer(r"/releases/tag/([^\"'<\s?#]+)", text or ""):
        tag = urllib.parse.unquote(match.group(1)).strip()
        if not tag or tag in seen:
            continue
        seen.add(tag)
        found.append(tag)
    return found


def _highest_tag(tags: list[str]) -> str:
    best = ""
    best_ver: tuple[int, ...] = (0,)
    for tag in tags:
        ver = normalize_version(tag)
        if not best or ver > best_ver:
            best = tag
            best_ver = ver
    return best


def _release_from_atom(xml_text: str) -> dict[str, Any] | None:
    tag = _highest_tag(_tags_from_text(xml_text))
    if not tag:
        return None
    return _minimal_release(tag)


def _release_from_latest_html(final_url: str, body_text: str) -> dict[str, Any] | None:
    tags = _tags_from_text(final_url) + _tags_from_text(body_text)
    tag = _highest_tag(tags)
    if not tag:
        return None
    html_url = final_url if "/releases/tag/" in final_url else release_notes_url(tag)
    return _minimal_release(tag, html_url)


def _enrich_assets(release: dict[str, Any]) -> dict[str, Any]:
    assets = release.get("assets")
    if isinstance(assets, list) and assets:
        return release
    tag = _release_tag(release)
    if not tag:
        return release
    stripped = tag.lstrip("vV")
    candidates = [tag]
    if stripped and stripped != tag:
        candidates.append(stripped)
        candidates.append(f"v{stripped}")
    elif stripped:
        candidates.append(f"v{stripped}")
    for candidate in candidates:
        try:
            data = _github_get(RELEASE_BY_TAG_API + urllib.parse.quote(candidate, safe=""))
        except Exception:
            continue
        if isinstance(data, dict) and isinstance(data.get("assets"), list) and data["assets"]:
            merged = dict(release)
            merged.update({k: data[k] for k in ("assets", "html_url", "tag_name", "name") if k in data})
            return merged
    return release


def _fetch_from_list_api() -> dict[str, Any] | None:
    data = _github_get(RELEASES_LIST_API)
    if isinstance(data, list):
        return _pick_highest_version_release(data)
    return None


def _fetch_from_latest_api() -> dict[str, Any] | None:
    data = _github_get(RELEASES_LATEST_API)
    return data if isinstance(data, dict) and _release_tag(data) else None


def _fetch_from_atom() -> dict[str, Any] | None:
    raw, _final = _http_get(
        RELEASES_ATOM,
        accept="application/atom+xml, application/xml, text/xml",
    )
    return _release_from_atom(raw.decode("utf-8", errors="replace"))


def _fetch_from_html() -> dict[str, Any] | None:
    raw, final = _http_get(RELEASES_PAGE, accept="text/html,application/xhtml+xml")
    return _release_from_latest_html(final, raw.decode("utf-8", errors="replace"))


def _fetch_latest_release() -> dict[str, Any] | None:
    """
    Resolve the highest published version (by semver). Tries GitHub JSON APIs,
    then the public atom feed, then the HTML latest-release redirect — so a
    rate-limit or TLS hiccup on one channel does not hide an update.
    """
    for fetch in (
        _fetch_from_list_api,
        _fetch_from_latest_api,
        _fetch_from_atom,
        _fetch_from_html,
    ):
        try:
            picked = fetch()
        except Exception:
            continue
        if picked:
            try:
                return _enrich_assets(picked)
            except Exception:
                return picked
    return None


def check_for_update() -> dict[str, Any]:
    """
    Compare the running app to the highest GitHub release version.

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
        tag = _release_tag(release)
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
        release_url = str(release.get("html_url") or "").strip() or RELEASES_PAGE
        if not is_allowed_download_url(release_url):
            release_url = RELEASES_PAGE

        support = check_support_status()
        return {
            "ok": True,
            "update": True,
            "checked": True,
            "currentVersion": current,
            "latestVersion": latest_display,
            "latestTag": tag,
            "platform": key,
            "downloadUrl": download_url,
            "releaseUrl": release_url,
            "instructions": replace_instructions(key),
            "releaseDate": support.get("releaseDate"),
            "supportExpiresOn": support.get("expiresOn"),
            "expiresOn": support.get("expiresOn"),
            "supportMonths": support.get("supportMonths"),
            "supportExpired": bool(support.get("expired")),
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
