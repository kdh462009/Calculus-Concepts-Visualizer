window.APP_VERSION = "1.2";

const APP_LOGO_URL = (() => {
  const script = document.currentScript;
  if (script?.src) return new URL("logo.png", script.src).href;
  return "../core/logo.png";
})();

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
  if (window.pywebview?.api) {
    Promise.resolve().then(fn);
  } else {
    window.addEventListener("pywebviewready", () => fn(), { once: true });
  }
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
  const goHome = () => window.pywebview.api.go_home();
  if (window.VizTransition?.navigateWithWoosh) {
    window.VizTransition.navigateWithWoosh(window.VizTransition.back, goHome);
  } else {
    goHome();
  }
});
