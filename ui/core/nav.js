/** Run callback once the pywebview API is available (including after in-app navigation). */
function whenApiReady(fn) {
  if (window.pywebview?.api) {
    Promise.resolve().then(fn);
  } else {
    window.addEventListener("pywebviewready", () => fn(), { once: true });
  }
}
