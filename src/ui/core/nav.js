window.APP_VERSION = "1.3";

const APP_LOGO_URL = (() => {
  const script = document.currentScript;
  if (script?.src) return new URL("logo.png", script.src).href;
  return "../core/logo.png";
})();

function stampAppFooter() {
  const shell = document.querySelector(".app-shell");
  if (!shell) return;

  const extras = [...document.querySelectorAll("[data-credit-extra]")];
  let footer = document.querySelector("footer.credit-row");
  if (!footer) {
    footer = document.createElement("footer");
    footer.className = "credit-row";
    shell.appendChild(footer);
  }

  footer.innerHTML = `
    <span>Made with ❤️ by Agniva, Donghui, Manya, and Adam · <span class="app-version" data-app-version></span></span>
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
}

function stampAppVersion() {
  document.querySelectorAll("[data-app-version]").forEach((el) => {
    el.textContent = `Version ${window.APP_VERSION}`;
  });
}

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
    if (tries >= 80) clearInterval(poll);
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
