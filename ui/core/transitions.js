/**
 * Woosh transitions between launcher and visualizers.
 * forward = into a visualizer, back = return to home
 */
(function applyPendingEnter() {
  const dir = sessionStorage.getItem("vizTransitionDir");
  if (dir === "forward" || dir === "back") {
    document.documentElement.classList.add(`woosh-pending-${dir}`);
  }
})();

const TRANSITION_KEY = "vizTransitionDir";
const WOOSH_MS = 340;

function ensureOverlay() {
  let overlay = document.getElementById("wooshOverlay");
  if (overlay) return overlay;

  overlay = document.createElement("div");
  overlay.id = "wooshOverlay";
  overlay.className = "woosh-overlay";
  overlay.setAttribute("aria-hidden", "true");
  overlay.innerHTML = '<div class="woosh-cover"></div><div class="woosh-streak"></div><div class="woosh-glow"></div>';
  document.body.appendChild(overlay);
  return overlay;
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clearWooshClasses() {
  const overlay = document.getElementById("wooshOverlay");
  overlay?.classList.remove("active", "forward", "back");
  document.querySelector(".app-shell")?.classList.remove(
    "woosh-exit-forward",
    "woosh-exit-back",
  );
}

function playWooshOut(direction, options = {}) {
  const { holdVisualState = false } = options;
  if (prefersReducedMotion()) return wait(80);

  const overlay = ensureOverlay();
  const shell = document.querySelector(".app-shell");
  const exitClass = `woosh-exit-${direction}`;

  return new Promise((resolve) => {
    let settled = false;
    let timeoutId = null;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (timeoutId) clearTimeout(timeoutId);
      if (!holdVisualState) {
        overlay.classList.remove("active", "forward", "back");
        shell?.classList.remove(exitClass);
      }
      resolve();
    };

    overlay.classList.add("active", direction);
    shell?.classList.add(exitClass);

    // Listen on both shell and overlay so we can settle as soon as the
    // first animation completes, while still having a hard fallback timeout.
    overlay.addEventListener("animationend", finish, { once: true });
    shell?.addEventListener("animationend", finish, { once: true });
    timeoutId = setTimeout(finish, WOOSH_MS + 120);
  });
}

function playWooshEnter(direction) {
  document.documentElement.classList.remove(`woosh-pending-${direction}`);

  if (prefersReducedMotion()) return;

  const shell = document.querySelector(".app-shell");
  if (!shell) return;

  const enterClass = `woosh-enter-${direction}`;
  shell.classList.add(enterClass);
  shell.addEventListener(
    "animationend",
    () => shell.classList.remove(enterClass),
    { once: true },
  );
}

function initPageTransition() {
  const dir = sessionStorage.getItem(TRANSITION_KEY);
  if (dir !== "forward" && dir !== "back") return;
  const shell = document.querySelector(".app-shell");
  if (!shell) return;
  sessionStorage.removeItem(TRANSITION_KEY);
  // Start immediately when shell exists; delaying until bootstrap causes a hitch.
  playWooshEnter(dir);
}

let _navigating = false;

async function navigateWithWoosh(direction, navigateFn) {
  if (_navigating) return;
  _navigating = true;
  window.__vizNavigating = true;
  try {
    sessionStorage.setItem(TRANSITION_KEY, direction);
    const wooshOutPromise = playWooshOut(direction, { holdVisualState: true });
    // Start navigation before the full woosh completes to avoid a visible pause.
    await Promise.race([wooshOutPromise, wait(Math.floor(WOOSH_MS * 0.55))]);
    await navigateFn();
    // Keep the held cover/exit classes until navigation commits to avoid
    // any flashback of the old page during the handoff.
  } catch (error) {
    // If navigation fails and this page remains active, recover cleanly.
    sessionStorage.removeItem(TRANSITION_KEY);
    clearWooshClasses();
    throw error;
  } finally {
    _navigating = false;
    window.__vizNavigating = false;
  }
}

// PyWebView can throw when a page navigates away while an async API call is in-flight,
// because the callback map is cleared on the new page. Suppress those navigation-time
// callback errors so they don't surface as noisy uncaught exceptions.
(function installPyWebviewNavigationGuards() {
  if (window.__pywebviewNavGuardsInstalled) return;
  window.__pywebviewNavGuardsInstalled = true;

  function isPyWebviewCallbackGoneError(reason) {
    const msg = String(
      reason?.message || reason?.error || reason?.reason || reason || "",
    );
    return msg.includes("_returnValuesCallbacks") && msg.includes("is undefined");
  }

  window.addEventListener("unhandledrejection", (event) => {
    if (!window.__vizNavigating) return;
    if (!isPyWebviewCallbackGoneError(event.reason)) return;
    event.preventDefault();
  });

  window.addEventListener("error", (event) => {
    if (!window.__vizNavigating) return;
    if (!isPyWebviewCallbackGoneError(event?.error || event?.message)) return;
    event.preventDefault();
  });
})();

window.VizTransition = {
  forward: "forward",
  back: "back",
  navigateWithWoosh,
  initPageTransition,
};

// Run enter transition as soon as DOM is ready so it isn't delayed by app bootstrap.
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initPageTransition, { once: true });
} else {
  initPageTransition();
}
