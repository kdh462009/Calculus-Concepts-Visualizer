window.APP_VERSION = "1.3";

const APP_LOGO_URL = (() => {
  const script = document.currentScript;
  if (script?.src) return new URL("logo.png", script.src).href;
  return "../core/logo.png";
})();

function stampAppFooter() {
  const shell = document.querySelector(".app-shell");
  if (!shell) return;
  if (document.documentElement.dataset.appFooterStamped === "1") return;

  const extras = [...document.querySelectorAll("[data-credit-extra]")];
  const footer = document.createElement("footer");
  footer.className = "credit-row";
  shell.appendChild(footer);

  footer.innerHTML = `
    <span>Made with ❤️ by Agniva, Donghui, Manya, and Adam · <button type="button" class="app-version" data-app-version data-check-updates title="Check for updates">Version ${window.APP_VERSION}</button></span>
    <span class="credit-legal">
      Licensed under
      <a href="https://creativecommons.org/licenses/by-nc-sa/4.0/deed.en" data-external="true" rel="license">CC BY-NC-SA 4.0</a> 
      (Attribution-NonCommercial-ShareAlike 4.0 International)
      ·
      <a href="https://github.com/kdh462009/Calculus-Concepts-Visualizer" data-external="true">GitHub</a>
      · Covered by the
      <a href="https://knivier.com/tos-ssp.html" data-external="true">Knivier SSP/ToS (Open Source Restricted with educational exceptions)</a>
    </span>
  `;

  const legal = footer.querySelector(".credit-legal");
  extras.forEach((extra) => {
    extra.removeAttribute("data-credit-extra");
    footer.insertBefore(extra, legal);
  });

  document.documentElement.dataset.appFooterStamped = "1";
}

function stampAppVersion() {
  document.querySelectorAll("[data-app-version]").forEach((el) => {
    el.textContent = `Version ${window.APP_VERSION}`;
  });
}

let versionCheckBusy = false;
let versionCheckResetTimer = null;

function setVersionLabel(text) {
  document.querySelectorAll("[data-app-version]").forEach((el) => {
    el.textContent = text;
  });
}

function restoreVersionLabelSoon(ms = 1800) {
  if (versionCheckResetTimer) clearTimeout(versionCheckResetTimer);
  versionCheckResetTimer = setTimeout(() => {
    stampAppVersion();
    versionCheckBusy = false;
  }, ms);
}

async function runManualUpdateCheck() {
  if (versionCheckBusy) return;
  if (typeof window.pywebview?.api?.check_for_update !== "function") {
    setVersionLabel("Unavailable");
    restoreVersionLabelSoon();
    return;
  }
  versionCheckBusy = true;
  setVersionLabel("Checking…");
  try {
    const info = await window.pywebview.api.check_for_update();
    if (info?.update) {
      if (typeof window.showUpdateModal === "function") {
        window.showUpdateModal(info);
        stampAppVersion();
        versionCheckBusy = false;
      } else {
        setVersionLabel(`Update ${info.latestVersion || ""}`.trim());
        try {
          await window.pywebview.api.open_update_download(info.downloadUrl || "");
        } catch {
          /* ignore */
        }
        restoreVersionLabelSoon(2200);
      }
      return;
    }
    if (info?.checked) {
      setVersionLabel("Up to date");
      restoreVersionLabelSoon();
      return;
    }
    setVersionLabel("Check failed");
    restoreVersionLabelSoon();
  } catch {
    setVersionLabel("Check failed");
    restoreVersionLabelSoon();
  }
}

document.addEventListener("click", (event) => {
  const node = event.target instanceof Element ? event.target : event.target.parentElement;
  const versionBtn = node?.closest?.("[data-check-updates]");
  if (versionBtn) {
    event.preventDefault();
    runManualUpdateCheck();
  }
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
  stampAppFooter();
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

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || event.defaultPrevented) return;
  if (document.body?.dataset.page === "home") {
    if (isTypingTarget(event.target)) return;
    if (typeof window.closeHomeShortcuts === "function" && window.closeHomeShortcuts()) {
      event.preventDefault();
    }
    return;
  }
  if (typeof window.pywebview?.api?.go_home !== "function") return;
  event.preventDefault();
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
});
