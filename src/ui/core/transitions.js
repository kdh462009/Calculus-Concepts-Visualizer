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
const WOOSH_MS = 200;
const BACK_NAV_AT_MS = 72;

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
    timeoutId = setTimeout(finish, WOOSH_MS + 80);
  });
}

function playWooshEnter(direction) {
  const pendingClass = `woosh-pending-${direction}`;
  const shell = document.querySelector(".app-shell");
  if (!shell) {
    document.documentElement.classList.remove(pendingClass, "woosh-enter-active");
    return;
  }

  if (prefersReducedMotion()) {
    document.documentElement.classList.remove(pendingClass, "woosh-enter-active");
    if (typeof window.stampDeferredHomeFooter === "function") {
      window.stampDeferredHomeFooter();
      window.stampDeferredHomeFooter = null;
    }
    return;
  }

  const enterClass = `woosh-enter-${direction}`;
  document.documentElement.classList.add("woosh-enter-active");
  shell.classList.add(enterClass);
  // Commit enter start state while woosh-pending still hides the shell.
  void shell.offsetWidth;
  document.documentElement.classList.remove(pendingClass);

  const finish = () => {
    shell.classList.remove(enterClass);
    document.documentElement.classList.remove("woosh-enter-active");
    if (typeof window.stampDeferredHomeFooter === "function") {
      window.stampDeferredHomeFooter();
      window.stampDeferredHomeFooter = null;
    }
  };
  shell.addEventListener("animationend", finish, { once: true });
}

function initPageTransition() {
  const dir = sessionStorage.getItem(TRANSITION_KEY);
  if (dir !== "forward" && dir !== "back") return;
  const shell = document.querySelector(".app-shell");
  if (!shell) return;
  sessionStorage.removeItem(TRANSITION_KEY);
  playWooshEnter(dir);
}

function shouldDeferHomeEnter() {
  const dir = sessionStorage.getItem(TRANSITION_KEY);
  return document.body?.dataset.page === "home" && (dir === "forward" || dir === "back");
}

let _navigating = false;
let _navFailsafeId = 0;
const NAV_FAILSAFE_MS = 1500;

function unlockNavigation() {
  _navigating = false;
  window.__vizNavigating = false;
}

function abortNavigation() {
  if (_navFailsafeId) {
    clearTimeout(_navFailsafeId);
    _navFailsafeId = 0;
  }
  sessionStorage.removeItem(TRANSITION_KEY);
  clearWooshClasses();
  unlockNavigation();
}

function isPyWebviewCallbackGoneError(reason) {
  const msg = String(
    reason?.message || reason?.error || reason?.reason || reason || "",
  );
  return msg.includes("_returnValuesCallbacks");
}

async function navigateWithWoosh(direction, navigateFn) {
  if (_navigating || window.__vizNavigating) return;
  _navigating = true;
  window.__vizNavigating = true;

  let leaving = false;
  const markLeaving = () => {
    leaving = true;
    if (_navFailsafeId) {
      clearTimeout(_navFailsafeId);
      _navFailsafeId = 0;
    }
  };
  window.addEventListener("pagehide", markLeaving, { once: true });
  window.addEventListener("beforeunload", markLeaving, { once: true });
  _navFailsafeId = setTimeout(() => {
    if (leaving) return;
    abortNavigation();
  }, NAV_FAILSAFE_MS);

  try {
    sessionStorage.setItem(TRANSITION_KEY, direction);
    const wooshOutPromise = playWooshOut(direction, { holdVisualState: true });
    if (direction === "back") {
      // Cover is opaque early; navigate before the full streak finishes.
      await Promise.race([wooshOutPromise, wait(BACK_NAV_AT_MS)]);
    } else {
      await Promise.race([wooshOutPromise, wait(Math.floor(WOOSH_MS * 0.4))]);
    }
    const pending = navigateFn();
    if (pending && typeof pending.then === "function") {
      pending.then(
        (result) => {
          if (leaving) return;
          if (result && result.ok === false) abortNavigation();
        },
        (reason) => {
          if (leaving || isPyWebviewCallbackGoneError(reason)) return;
          abortNavigation();
        },
      );
    }
    // Stay locked until this page unloads, or the failsafe / a failed
    // bridge call aborts. Unlocking immediately lets a second Esc
    // schedule another load_url and wipe the home hub mid-bootstrap.
  } catch (error) {
    abortNavigation();
    throw error;
  }
}

// PyWebView can throw when a page navigates away while an async API call is in-flight,
// because the callback map is cleared on the new page. Suppress those navigation-time
// callback errors so they don't surface as noisy uncaught exceptions.
(function installPyWebviewNavigationGuards() {
  if (window.__pywebviewNavGuardsInstalled) return;
  window.__pywebviewNavGuardsInstalled = true;

  window.addEventListener("unhandledrejection", (event) => {
    if (!isPyWebviewCallbackGoneError(event.reason)) return;
    event.preventDefault();
  });

  window.addEventListener("error", (event) => {
    if (!isPyWebviewCallbackGoneError(event?.error || event?.message)) return;
    event.preventDefault();
  });
})();

window.VizTransition = {
  forward: "forward",
  back: "back",
  navigateWithWoosh,
  abortNavigation,
  initPageTransition,
  playWooshEnter,
};

function maybeInitPageTransition() {
  if (shouldDeferHomeEnter()) return;
  initPageTransition();
}

// Run enter transition as soon as DOM is ready on visualizer pages.
// Home defers until the hub has rendered (see home/app.js bootstrap).
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", maybeInitPageTransition, { once: true });
} else {
  maybeInitPageTransition();
}
