window.APP_VERSION = "1.2";

function stampAppVersion() {
  document.querySelectorAll("[data-app-version]").forEach((el) => {
    el.textContent = `Version ${window.APP_VERSION}`;
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", stampAppVersion);
} else {
  stampAppVersion();
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
