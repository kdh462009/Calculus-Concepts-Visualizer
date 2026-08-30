window.APP_VERSION = "1.3.1";

const RELEASE_NOTES_BASE =
  "https://github.com/kdh462009/Calculus-Concepts-Visualizer/releases/tag/";

function changelogHrefFor(version) {
  const tag = String(version || window.APP_VERSION || "").trim().replace(/^v/i, "");
  if (!tag) {
    return "https://github.com/kdh462009/Calculus-Concepts-Visualizer/releases/latest";
  }
  return `${RELEASE_NOTES_BASE}${encodeURIComponent(tag)}`;
}

const APP_LOGO_URL = (() => {
  const script = document.currentScript;
  if (script?.src) return new URL("logo.png", script.src).href;
  return "../core/logo.png";
})();

function ensureAppInfoModal() {
  if (document.getElementById("appInfoModal")) return;
  const root = document.createElement("div");
  root.id = "appInfoModal";
  root.className = "app-info-modal";
  root.hidden = true;
  root.innerHTML = `
    <div class="app-info-backdrop" data-app-info-dismiss></div>
    <div class="app-info-card" role="dialog" aria-modal="true" aria-labelledby="appInfoTitle">
      <button type="button" class="app-info-close" data-app-info-dismiss aria-label="Close">×</button>
      <h2 id="appInfoTitle">About Concept Visualizers</h2>
      <section class="app-info-section">
        <h3>Release notes</h3>
        <p>
          <a href="${changelogHrefFor(window.APP_VERSION)}" class="app-changelog" data-external="true" data-app-changelog title="Release notes for this version">Changelog for Version ${window.APP_VERSION}</a>
        </p>
      </section>
      <section class="app-info-section">
        <h3>License</h3>
        <p>
          Licensed under
          <a href="https://creativecommons.org/licenses/by-nc-sa/4.0/deed.en" data-external="true" rel="license">CC BY-NC-SA 4.0</a>
          (Attribution-NonCommercial-ShareAlike 4.0 International).
        </p>
      </section>
      <section class="app-info-section">
        <h3>SSP / Terms of Service</h3>
        <p>
          Covered by the
          <a href="https://knivier.com/tos-ssp.html" data-external="true">Knivier SSP/ToS</a>
          (Open Source Restricted with educational exceptions).
          Accredited classroom and nonprofit educational use is permitted under the
          <a href="https://knivier.com/tos-ssp.html#exceptions" data-external="true">exception policy</a>.
          Commercial redistribution, relicensing, or use outside those exceptions requires separate permission.
        </p>
      </section>
      <section class="app-info-section">
        <h3>Source</h3>
        <p>
          <a href="https://github.com/kdh462009/Calculus-Concepts-Visualizer" data-external="true">GitHub repository</a>
        </p>
      </section>
      <section class="app-info-extras" hidden></section>
    </div>
  `;
  document.body.appendChild(root);
}

function openAppInfoModal() {
  ensureAppInfoModal();
  const modal = document.getElementById("appInfoModal");
  if (!modal || !modal.hidden) return;
  modal.hidden = false;
  document.body.classList.add("app-info-open");
  modal.querySelector(".app-info-close")?.focus();
}

function closeAppInfoModal() {
  const modal = document.getElementById("appInfoModal");
  if (!modal || modal.hidden) return;
  modal.hidden = true;
  document.body.classList.remove("app-info-open");
}

window.openAppInfoModal = openAppInfoModal;
window.closeAppInfoModal = closeAppInfoModal;

let pendingVersionCheckInfo = null;

function ensureVersionCheckModal() {
  if (document.getElementById("versionCheckModal")) return;
  const root = document.createElement("div");
  root.id = "versionCheckModal";
  root.className = "version-check-modal";
  root.hidden = true;
  root.innerHTML = `
    <div class="version-check-backdrop" data-version-check-dismiss></div>
    <div class="version-check-card" role="dialog" aria-modal="true" aria-labelledby="versionCheckTitle">
      <button type="button" class="version-check-close" data-version-check-dismiss aria-label="Close">×</button>
      <h2 id="versionCheckTitle">Checking for updates</h2>
      <div class="version-check-progress-wrap" data-version-check-progress-wrap>
        <div class="version-check-progress-track">
          <div class="version-check-progress-bar" data-version-check-progress-bar style="width: 0%"></div>
        </div>
      </div>
      <p class="version-check-status" data-version-check-status aria-live="polite">Connecting to release servers…</p>
      <div class="version-check-body" data-version-check-body hidden></div>
      <div class="version-check-actions" data-version-check-actions hidden></div>
    </div>
  `;
  document.body.appendChild(root);

  root.querySelectorAll("[data-version-check-dismiss]").forEach((node) => {
    node.addEventListener("click", (event) => {
      event.preventDefault();
      closeVersionCheckModal();
    });
  });

  root.addEventListener("click", (event) => {
    const action = event.target instanceof Element
      ? event.target.closest("[data-version-check-action]")
      : null;
    if (!action) return;
    event.preventDefault();
    const kind = action.getAttribute("data-version-check-action");
    if (kind === "download") {
      openExternalUrl(pendingVersionCheckInfo?.downloadUrl || "");
      closeVersionCheckModal();
      return;
    }
    if (kind === "changelog-current") {
      openExternalUrl(changelogHrefFor(window.APP_VERSION));
      closeVersionCheckModal();
      return;
    }
    if (kind === "changelog-latest") {
      const latest = pendingVersionCheckInfo?.latestVersion || pendingVersionCheckInfo?.latestTag;
      openExternalUrl(
        pendingVersionCheckInfo?.releaseUrl
          || changelogHrefFor(latest)
          || "https://github.com/kdh462009/Calculus-Concepts-Visualizer/releases/latest",
      );
      closeVersionCheckModal();
      return;
    }
    if (kind === "retry") {
      closeVersionCheckModal();
      runManualUpdateCheck();
      return;
    }
  });
}

function openExternalUrl(url) {
  const target = String(url || "").trim();
  if (!target) return;
  if (window.pywebview?.api?.open_update_download) {
    window.pywebview.api.open_update_download(target);
    return;
  }
  if (window.pywebview?.api?.open_external) {
    window.pywebview.api.open_external(target);
    return;
  }
  window.open(target, "_blank", "noopener");
}

function closeVersionCheckModal() {
  const modal = document.getElementById("versionCheckModal");
  if (!modal || modal.hidden) return;
  modal.hidden = true;
  document.body.classList.remove("version-check-open");
  pendingVersionCheckInfo = null;
}

function setVersionCheckUi({
  title,
  status,
  progress = null,
  bodyHtml = "",
  actionsHtml = "",
  showProgress = true,
}) {
  ensureVersionCheckModal();
  const modal = document.getElementById("versionCheckModal");
  const titleEl = modal.querySelector("#versionCheckTitle");
  const statusEl = modal.querySelector("[data-version-check-status]");
  const bodyEl = modal.querySelector("[data-version-check-body]");
  const actionsEl = modal.querySelector("[data-version-check-actions]");
  const progressWrap = modal.querySelector("[data-version-check-progress-wrap]");
  const progressBar = modal.querySelector("[data-version-check-progress-bar]");

  if (titleEl) titleEl.textContent = title;
  if (statusEl) statusEl.textContent = status;
  if (progressWrap) progressWrap.hidden = !showProgress;
  if (progressBar && progress !== null) {
    progressBar.style.width = `${Math.max(0, Math.min(100, progress))}%`;
  }
  if (bodyEl) {
    bodyEl.innerHTML = bodyHtml;
    bodyEl.hidden = !bodyHtml;
  }
  if (actionsEl) {
    actionsEl.innerHTML = actionsHtml;
    actionsEl.hidden = !actionsHtml;
  }
}

function openVersionCheckChecking() {
  ensureVersionCheckModal();
  const modal = document.getElementById("versionCheckModal");
  modal.hidden = false;
  document.body.classList.add("version-check-open");
  setVersionCheckUi({
    title: "Checking for updates",
    status: "Connecting to release servers…",
    progress: 8,
    bodyHtml: "",
    actionsHtml: "",
    showProgress: true,
  });
}

function renderVersionCheckResult(info) {
  const current = info?.currentVersion || window.APP_VERSION;
  if (info?.update) {
    pendingVersionCheckInfo = info;
    const latest = info.latestVersion || info.latestTag || "—";
    setVersionCheckUi({
      title: "Update available",
      status: `Version ${latest} is available · you're on ${current}`,
      progress: 100,
      showProgress: false,
      bodyHtml: `<p class="version-check-note">Download and replace your current installation.</p>`,
      actionsHtml: `
        <button type="button" class="version-check-btn version-check-btn-primary" data-version-check-action="download">Download</button>
        <button type="button" class="version-check-btn" data-version-check-action="changelog-latest">Changelog</button>
      `,
    });
    return;
  }

  if (info?.checked) {
    setVersionCheckUi({
      title: "Up to date",
      status: `Version ${current} is the latest release.`,
      progress: 100,
      showProgress: false,
      bodyHtml: "",
      actionsHtml: `
        <button type="button" class="version-check-btn version-check-btn-primary" data-version-check-action="changelog-current">Changelog</button>
      `,
    });
    return;
  }

  const offline = typeof window.pywebview?.api?.check_for_update !== "function";
  setVersionCheckUi({
    title: offline ? "Update check unavailable" : "Couldn't check for updates",
    status: offline
      ? "Not connected to the app updater."
      : (info?.error ? String(info.error) : "Release servers did not respond."),
    progress: 100,
    showProgress: false,
    bodyHtml: "",
    actionsHtml: offline
      ? `<button type="button" class="version-check-btn version-check-btn-primary" data-version-check-action="changelog-current">Changelog</button>`
      : `<button type="button" class="version-check-btn version-check-btn-primary" data-version-check-action="retry">Try again</button>
         <button type="button" class="version-check-btn" data-version-check-action="changelog-current">Changelog</button>`,
  });
}

function stampAppFooter() {
  const shell = document.querySelector(".app-shell");
  if (!shell) return;
  if (document.documentElement.dataset.appFooterStamped === "1") return;

  ensureAppInfoModal();
  ensureVersionCheckModal();
  const extras = [...document.querySelectorAll("[data-credit-extra]")];
  const footer = document.createElement("footer");
  footer.className = "credit-row";
  shell.appendChild(footer);

  footer.innerHTML = `
    <span class="credit-primary">Made with ❤️ by Agniva, Donghui, and Manya · <button type="button" class="app-version" data-app-version data-check-updates title="Check for updates">Version ${window.APP_VERSION}</button> · <button type="button" class="app-info-btn" data-app-info title="About, license, and release notes" aria-label="About and legal information"><span aria-hidden="true">i</span></button></span>
  `;

  const extrasHost = document.querySelector("#appInfoModal .app-info-extras");
  if (extrasHost && extras.length) {
    extrasHost.hidden = false;
    extras.forEach((extra) => {
      extra.removeAttribute("data-credit-extra");
      extrasHost.appendChild(extra);
    });
  }

  document.documentElement.dataset.appFooterStamped = "1";
}

function stampAppVersion() {
  const version = window.APP_VERSION;
  document.querySelectorAll("[data-app-version]").forEach((el) => {
    el.textContent = `Version ${version}`;
  });
  document.querySelectorAll("[data-app-changelog]").forEach((el) => {
    el.setAttribute("href", changelogHrefFor(version));
    if (el.closest("#appInfoModal")) {
      el.textContent = `Changelog for Version ${version}`;
    }
  });
}

let versionCheckBusy = false;

function waitMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const VERSION_CHECK_LABELS = [
  "Connecting to release servers…",
  "Checking published versions…",
  "Verifying your build…",
];

async function checkForUpdateWithRetry(attempts = 3, options = {}) {
  const onProgress = typeof options.onProgress === "function" ? options.onProgress : null;
  if (typeof window.pywebview?.api?.check_for_update !== "function") {
    return null;
  }
  let last = null;
  const n = Math.max(1, attempts);
  for (let i = 0; i < n; i += 1) {
    onProgress?.({
      attempt: i + 1,
      total: n,
      label: VERSION_CHECK_LABELS[i] || VERSION_CHECK_LABELS[VERSION_CHECK_LABELS.length - 1],
      ratio: (i + 0.15) / n,
    });
    try {
      last = await window.pywebview.api.check_for_update();
      onProgress?.({
        attempt: i + 1,
        total: n,
        label: last?.update ? "Update found." : "Release info received.",
        ratio: (i + 1) / n,
      });
      if (last?.checked || last?.update) return last;
    } catch (err) {
      last = { ok: false, checked: false, update: false, error: String(err) };
    }
    if (i < n - 1) await waitMs(350 * (i + 1));
  }
  onProgress?.({
    attempt: n,
    total: n,
    label: "Finishing up…",
    ratio: 1,
  });
  return last;
}

window.checkForUpdateWithRetry = checkForUpdateWithRetry;

async function runManualUpdateCheck() {
  if (versionCheckBusy) return;
  versionCheckBusy = true;
  openVersionCheckChecking();
  try {
    const info = await checkForUpdateWithRetry(3, {
      onProgress: ({ label, ratio }) => {
        setVersionCheckUi({
          title: "Checking for updates",
          status: label,
          progress: Math.round(12 + ratio * 78),
          bodyHtml: "",
          actionsHtml: "",
          showProgress: true,
        });
      },
    });
    setVersionCheckUi({
      title: "Checking for updates",
      status: "Done.",
      progress: 100,
      bodyHtml: "",
      actionsHtml: "",
      showProgress: true,
    });
    await waitMs(180);
    renderVersionCheckResult(info);
  } catch (err) {
    renderVersionCheckResult({ ok: false, checked: false, update: false, error: String(err) });
  } finally {
    versionCheckBusy = false;
    stampAppVersion();
  }
}

document.addEventListener("click", (event) => {
  const node = event.target instanceof Element ? event.target : event.target.parentElement;
  const versionBtn = node?.closest?.("[data-check-updates]");
  if (versionBtn) {
    event.preventDefault();
    runManualUpdateCheck();
    return;
  }
  if (node?.closest?.("[data-app-info]")) {
    event.preventDefault();
    openAppInfoModal();
    return;
  }
  if (node?.closest?.("[data-app-info-dismiss]")) {
    event.preventDefault();
    closeAppInfoModal();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  const versionModal = document.getElementById("versionCheckModal");
  if (versionModal && !versionModal.hidden) {
    closeVersionCheckModal();
    return;
  }
  const modal = document.getElementById("appInfoModal");
  if (modal && !modal.hidden) closeAppInfoModal();
});

function stampAppLogo() {
  if (!document.querySelector("link[rel='icon']")) {
    const favicon = document.createElement("link");
    favicon.rel = "icon";
    favicon.href = APP_LOGO_URL;
    document.head.appendChild(favicon);
  }
  if (document.querySelector(".app-logo")) return;

  const img = document.createElement("img");
  img.className = "app-logo";
  img.src = APP_LOGO_URL;
  img.alt = "";
  img.width = 40;
  img.height = 40;

  const launcher = document.querySelector(".launcher-header");
  if (launcher) {
    launcher.insertBefore(img, launcher.firstChild);
    return;
  }
  const titleRow = document.querySelector(".header .title-row");
  if (titleRow) titleRow.insertBefore(img, titleRow.firstChild);
}

function stampChrome() {
  const pending = sessionStorage.getItem("vizTransitionDir");
  const isHome = document.body?.dataset.page === "home";
  if (isHome && (pending === "back" || pending === "forward")) {
    window.stampDeferredHomeFooter = stampAppFooter;
  } else {
    stampAppFooter();
  }
  stampAppVersion();
  stampAppLogo();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", stampChrome);
} else {
  stampChrome();
}

/** Run callback once the pywebview API is available (including after in-app navigation). */
function whenApiReady(fn) {
  let started = false;
  const start = () => {
    if (started) return;
    started = true;
    Promise.resolve().then(fn);
  };
  if (window.pywebview?.api) {
    start();
    return;
  }
  window.addEventListener("pywebviewready", start, { once: true });
  let tries = 0;
  const poll = setInterval(() => {
    if (window.pywebview?.api) {
      clearInterval(poll);
      start();
      return;
    }
    tries += 1;
    if (tries >= 80) {
      clearInterval(poll);
      const status = document.querySelector(".status, .fourier-status, #status");
      if (status && !window.pywebview?.api) {
        status.textContent = "Could not connect to the app backend. Restart the application.";
        status.classList?.add("is-error");
      }
    }
  }, 50);
}

document.addEventListener("click", (event) => {
  const node = event.target instanceof Element ? event.target : event.target.parentElement;
  const link = node?.closest?.("a[data-external]");
  if (!link) return;
  event.preventDefault();
  const url = link.href;
  if (window.pywebview?.api?.open_external) {
    window.pywebview.api.open_external(url);
    return;
  }
  window.open(url, "_blank", "noopener");
});

function isTypingTarget(target) {
  return target instanceof HTMLElement && (
    target.matches("input, textarea, select")
    || target.isContentEditable
  );
}

function goHomeWithWoosh() {
  if (window.__sspSoftlocked) return;
  if (typeof window.pywebview?.api?.go_home !== "function") return;
  // Stay locked while a transition is in flight. Aborting here and starting
  // another go_home lets Esc repeat / double Home overlap load_url and
  // interrupt the home hub mid-bootstrap. Stuck locks are cleared by the
  // navigateWithWoosh failsafe (or a failed bridge result).
  if (window.__vizNavigating) return;

  const goHome = () => {
    const pending = window.pywebview.api.go_home();
    if (pending && typeof pending.catch === "function") pending.catch(() => {});
  };
  if (window.VizTransition?.navigateWithWoosh) {
    window.VizTransition.navigateWithWoosh(window.VizTransition.back, goHome);
  } else {
    goHome();
  }
}

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || event.defaultPrevented) return;
  if (window.__sspSoftlocked) {
    event.preventDefault();
    beginSoftlockEscHold();
    return;
  }
  if (document.body?.dataset.page === "home") {
    if (isTypingTarget(event.target)) return;
    return;
  }
  // Key-repeat would otherwise spam goHomeWithWoosh while held.
  if (event.repeat) return;
  event.preventDefault();
  goHomeWithWoosh();
});

document.addEventListener("keyup", (event) => {
  if (event.key === "Escape") cancelSoftlockEscHold();
});
window.addEventListener("blur", () => cancelSoftlockEscHold());

// Reliable Home for every visualizer — works even if page bootstrap throws.
document.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target : null;
  const homeBtn = target?.closest?.("#homeBtn");
  if (!homeBtn) return;
  if (document.body?.dataset.page === "home") return;
  event.preventDefault();
  event.stopImmediatePropagation();
  goHomeWithWoosh();
}, true);

let pendingSoftlockDownload = "";
let pendingSoftlockChangelog = "";
let softlockTimerId = null;
let softlockUnlockId = null;
let softlockExpiresAtMs = null;
let softlockEscHoldId = null;
let softlockEscHoldStartedAt = null;

const SOFTLOCK_DOWNLOAD_UNLOCK_S = 5;
const SOFTLOCK_ESC_HOLD_MS = 5000;
const SSP_DEV_BYPASS_KEY = "sspDevBypass";

function isSspDevBypass() {
  if (window.__sspDevBypass) return true;
  try {
    return sessionStorage.getItem(SSP_DEV_BYPASS_KEY) === "1";
  } catch {
    return false;
  }
}

function setSspDevBypass() {
  window.__sspDevBypass = true;
  try {
    sessionStorage.setItem(SSP_DEV_BYPASS_KEY, "1");
  } catch {
    /* ignore */
  }
}

async function openSoftlockUrl(url) {
  try {
    if (window.pywebview?.api?.open_update_download) {
      await window.pywebview.api.open_update_download(url || "");
    }
  } catch {
    /* ignore */
  }
}

function formatSoftlockDuration(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  const clock = `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  if (days > 0) return `${days}d ${clock}`;
  return clock;
}

function stopSoftlockTimer() {
  if (softlockTimerId) {
    clearInterval(softlockTimerId);
    softlockTimerId = null;
  }
  if (softlockUnlockId) {
    clearInterval(softlockUnlockId);
    softlockUnlockId = null;
  }
}

function tickSoftlockTimer() {
  const el = document.getElementById("sspSoftlockTimer");
  if (!el || softlockExpiresAtMs == null) return;
  const overdueMs = Date.now() - softlockExpiresAtMs;
  el.textContent = overdueMs >= 0
    ? `Out of date for ${formatSoftlockDuration(overdueMs)}`
    : `Locks in ${formatSoftlockDuration(-overdueMs)}`;
}

function startSoftlockTimer(expiresOn) {
  stopSoftlockTimer();
  const raw = String(expiresOn || "").trim();
  const parsed = raw ? new Date(`${raw}T00:00:00`) : null;
  softlockExpiresAtMs = parsed && !Number.isNaN(parsed.getTime())
    ? parsed.getTime()
    : Date.now();
  tickSoftlockTimer();
  softlockTimerId = setInterval(tickSoftlockTimer, 1000);
}

function startSoftlockDownloadUnlock() {
  const downloadBtn = document.getElementById("sspSoftlockDownload");
  const changelogBtn = document.getElementById("sspSoftlockChangelog");
  if (!downloadBtn) return;

  let remaining = SOFTLOCK_DOWNLOAD_UNLOCK_S;
  downloadBtn.disabled = true;
  if (changelogBtn) changelogBtn.disabled = true;

  const paint = () => {
    downloadBtn.textContent = remaining > 0
      ? `Download Update (${remaining})`
      : "Download Update";
  };
  paint();

  if (softlockUnlockId) clearInterval(softlockUnlockId);
  softlockUnlockId = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      clearInterval(softlockUnlockId);
      softlockUnlockId = null;
      downloadBtn.disabled = false;
      if (changelogBtn) changelogBtn.disabled = false;
      downloadBtn.textContent = "Download Update";
      return;
    }
    paint();
  }, 1000);
}

function setSoftlockEscHint(active, remainingSec) {
  const el = document.getElementById("sspSoftlockEscHint");
  if (!el) return;
  el.hidden = false;
  el.classList.toggle("is-active", Boolean(active));
  if (active && remainingSec != null) {
    el.textContent = `Esc for Developers (${remainingSec})`;
  } else {
    el.textContent = "Esc for Developers";
  }
}

function cancelSoftlockEscHold() {
  if (softlockEscHoldId) {
    clearInterval(softlockEscHoldId);
    softlockEscHoldId = null;
  }
  softlockEscHoldStartedAt = null;
  if (window.__sspSoftlocked) {
    setSoftlockEscHint(false);
  }
}

function beginSoftlockEscHold() {
  if (!window.__sspSoftlocked || softlockEscHoldStartedAt != null) return;
  softlockEscHoldStartedAt = Date.now();
  const tick = () => {
    if (!window.__sspSoftlocked || softlockEscHoldStartedAt == null) {
      cancelSoftlockEscHold();
      return;
    }
    const elapsed = Date.now() - softlockEscHoldStartedAt;
    const remainingMs = Math.max(0, SOFTLOCK_ESC_HOLD_MS - elapsed);
    const remainingSec = Math.ceil(remainingMs / 1000);
    if (remainingMs <= 0) {
      cancelSoftlockEscHold();
      unlockSoftlockForDeveloper();
      return;
    }
    setSoftlockEscHint(true, remainingSec);
  };
  tick();
  softlockEscHoldId = setInterval(tick, 100);
}

function ensureDevUnsupportedBanner() {
  let banner = document.getElementById("sspDevBanner");
  if (banner) {
    banner.hidden = false;
    return banner;
  }
  banner = document.createElement("div");
  banner.id = "sspDevBanner";
  banner.className = "ssp-dev-banner";
  banner.setAttribute("role", "status");
  banner.textContent = "UNSUPPORTED, DEVELOPER ONLY";
  document.body.appendChild(banner);
  document.body.classList.add("ssp-dev-bypass");
  return banner;
}

function unlockSoftlockForDeveloper() {
  setSspDevBypass();
  window.__sspSoftlocked = false;
  document.body.classList.remove("ssp-softlocked");
  stopSoftlockTimer();
  cancelSoftlockEscHold();

  const root = document.getElementById("sspSoftlock");
  if (root) root.hidden = true;

  ensureDevUnsupportedBanner();
}

function ensureSoftlockModal() {
  let root = document.getElementById("sspSoftlock");
  if (root) return root;

  root = document.createElement("div");
  root.id = "sspSoftlock";
  root.className = "ssp-softlock";
  root.hidden = true;
  root.setAttribute("role", "alertdialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-labelledby", "sspSoftlockTitle");
  root.innerHTML = `
    <div class="ssp-softlock-backdrop" aria-hidden="true"></div>
    <div class="ssp-softlock-card">
      <h2 id="sspSoftlockTitle">Version out of date</h2>
      <p id="sspSoftlockMessage"></p>
      <p class="ssp-softlock-meta">
        Running <strong id="sspSoftlockCurrent">—</strong>
        · Support ended <strong id="sspSoftlockExpires">—</strong>
      </p>
      <p class="ssp-softlock-timer" id="sspSoftlockTimer" aria-live="polite">Out of date for —</p>
      <div class="ssp-softlock-actions">
        <button id="sspSoftlockDownload" class="update-btn-primary" type="button">Download Update</button>
        <button id="sspSoftlockChangelog" class="ssp-softlock-ghost" type="button">Changelog</button>
        <button id="sspSoftlockEscHint" class="ssp-softlock-ghost ssp-softlock-esc-btn" type="button" tabindex="-1">Esc for Developers</button>
      </div>
    </div>
  `;
  document.body.appendChild(root);

  document.getElementById("sspSoftlockDownload")?.addEventListener("click", () => {
    openSoftlockUrl(pendingSoftlockDownload);
  });
  document.getElementById("sspSoftlockChangelog")?.addEventListener("click", () => {
    openSoftlockUrl(pendingSoftlockChangelog || pendingSoftlockDownload);
  });

  return root;
}

function showSoftlockModal(status, updateInfo) {
  if (isSspDevBypass()) {
    ensureDevUnsupportedBanner();
    return;
  }

  if (typeof window.hideUpdateModal === "function") {
    const wasLocked = window.__sspSoftlocked;
    window.__sspSoftlocked = false;
    try { window.hideUpdateModal(); } catch { /* ignore */ }
    window.__sspSoftlocked = wasLocked;
  }

  window.__sspSoftlocked = true;
  document.body.classList.add("ssp-softlocked");

  const root = ensureSoftlockModal();
  const msg = document.getElementById("sspSoftlockMessage");
  const current = document.getElementById("sspSoftlockCurrent");
  const expires = document.getElementById("sspSoftlockExpires");
  if (msg) {
    msg.textContent = status?.message
      || "This version is out of date and as a result from current SSP coverage, will result in limited functionality. It's recommended to update to the latest version due to security patches and important performance/feature updates";
  }
  if (current) current.textContent = status?.currentVersion || window.APP_VERSION || "—";
  if (expires) expires.textContent = status?.expiresOn || "—";

  const fallback = "https://github.com/kdh462009/Calculus-Concepts-Visualizer/releases/latest";
  pendingSoftlockDownload = updateInfo?.downloadUrl || updateInfo?.releaseUrl || fallback;
  pendingSoftlockChangelog = updateInfo?.releaseUrl || fallback;

  startSoftlockTimer(status?.expiresOn);
  startSoftlockDownloadUnlock();
  setSoftlockEscHint(false);
  root.hidden = false;
}

/**
 * Softlock when this build is past its six-month SSP window.
 * @returns {Promise<boolean>} true when locked
 */
async function enforceSupportWindow() {
  try {
    if (isSspDevBypass()) {
      ensureDevUnsupportedBanner();
      return false;
    }
    if (typeof window.pywebview?.api?.check_support_status !== "function") {
      return false;
    }
    const status = await window.pywebview.api.check_support_status();
    if (!status?.expired) return false;

    let updateInfo = null;
    try {
      updateInfo = await checkForUpdateWithRetry(3);
    } catch {
      /* offline — still softlock */
    }
    showSoftlockModal(status, updateInfo);
    return !isSspDevBypass();
  } catch {
    return false;
  }
}

window.enforceSupportWindow = enforceSupportWindow;
window.showSoftlockModal = showSoftlockModal;
window.unlockSoftlockForDeveloper = unlockSoftlockForDeveloper;

whenApiReady(() => {
  // Visualizer pages: enforce immediately. Home runs this from bootstrap.
  if (document.body?.dataset.page !== "home") {
    enforceSupportWindow();
  } else if (isSspDevBypass()) {
    ensureDevUnsupportedBanner();
  }
});
