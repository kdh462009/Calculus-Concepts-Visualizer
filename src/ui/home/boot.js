(function bootHome() {
  const MIN_STARTUP_MS = 1000;
  const UPDATE_CHECK_BUDGET_MS = 1400;

  const CORE_ASSETS = [
    { name: "styles.css", url: "../core/styles.css", kind: "css" },
    { name: "transitions.css", url: "../core/transitions.css", kind: "css" },
    { name: "transitions.js", url: "../core/transitions.js", kind: "js" },
    { name: "scale-bar.js", url: "../core/scale-bar.js", kind: "js" },
    { name: "graph.js", url: "../core/graph.js", kind: "js" },
    { name: "function-preview.js", url: "../core/function-preview.js", kind: "js" },
    { name: "nav.js", url: "../core/nav.js", kind: "js" },
    { name: "home/app.js", url: "./app.js", kind: "js" },
  ];
  const UPDATE_STEP_NAME = "updates";
  const LOAD_STEPS = CORE_ASSETS.length + 1;
  const RETURN_FAST_URLS = new Set([
    "../core/styles.css",
    "../core/transitions.css",
    "../core/transitions.js",
    "../core/nav.js",
    "./app.js",
  ]);

  function $(id) {
    return document.getElementById(id);
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function prefersReducedMotion() {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function loadAsset(asset) {
    return new Promise((resolve) => {
      const finish = () => resolve();
      if (asset.kind === "css") {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = asset.url;
        link.onload = finish;
        link.onerror = finish;
        document.head.appendChild(link);
        return;
      }
      const script = document.createElement("script");
      script.src = asset.url;
      script.async = false;
      script.onload = finish;
      script.onerror = finish;
      document.body.appendChild(script);
    });
  }

  function setLoadProgress(done, total, currentName) {
    const fill = $("openingLoadFill");
    const label = $("openingLoadLabel");
    const list = $("openingLoadList");
    if (fill) fill.style.width = `${Math.round((done / Math.max(total, 1)) * 100)}%`;
    if (label) {
      if (!currentName && done >= total) label.textContent = "Ready";
      else if (currentName === UPDATE_STEP_NAME) label.textContent = "Checking for updates…";
      else label.textContent = currentName ? `Loading ${currentName}` : "Starting…";
    }
    if (!list) return;
    list.querySelectorAll("li").forEach((item, index) => {
      item.classList.toggle("is-done", index < done);
      item.classList.toggle("is-active", Boolean(currentName) && index === done);
    });
  }

  function paintLoadList() {
    const list = $("openingLoadList");
    if (!list) return;
    const names = CORE_ASSETS.map((asset) => asset.name).concat(["updates"]);
    list.replaceChildren(
      ...names.map((name) => {
        const li = document.createElement("li");
        li.textContent = name;
        return li;
      }),
    );
  }

  function waitForApi(timeoutMs) {
    return new Promise((resolve) => {
      const ready = () => Boolean(window.pywebview?.api?.check_for_update);
      if (ready()) {
        resolve(true);
        return;
      }
      const onReady = () => {
        if (ready()) finish(true);
      };
      const finish = (ok) => {
        window.removeEventListener("pywebviewready", onReady);
        clearInterval(poll);
        clearTimeout(timer);
        resolve(ok);
      };
      window.addEventListener("pywebviewready", onReady);
      const poll = setInterval(onReady, 40);
      const timer = setTimeout(() => finish(false), timeoutMs);
    });
  }

  async function runStartupUpdateCheck() {
    const apiReady = await waitForApi(UPDATE_CHECK_BUDGET_MS);
    if (!apiReady) return null;
    try {
      if (typeof window.checkForUpdateWithRetry === "function") {
        return await window.checkForUpdateWithRetry(2);
      }
      if (typeof window.pywebview.api.check_for_update === "function") {
        return await window.pywebview.api.check_for_update();
      }
    } catch {
      return null;
    }
    return null;
  }

  function prefetchAssets() {
    CORE_ASSETS.forEach((asset) => {
      const link = document.createElement("link");
      link.rel = "preload";
      link.href = asset.url;
      link.as = asset.kind === "css" ? "style" : "script";
      document.head.appendChild(link);
    });
  }

  async function loadCoreAssets() {
    paintLoadList();
    prefetchAssets();
    const stepHoldMs = prefersReducedMotion() ? 0 : 48;

    for (let i = 0; i < CORE_ASSETS.length; i += 1) {
      const asset = CORE_ASSETS[i];
      setLoadProgress(i, LOAD_STEPS, asset.name);
      const t0 = performance.now();
      await loadAsset(asset);
      const hold = stepHoldMs - (performance.now() - t0);
      if (hold > 8) await wait(hold);
    }
    setLoadProgress(CORE_ASSETS.length, LOAD_STEPS, UPDATE_STEP_NAME);
  }

  async function finishWithUpdateCheck(started) {
    setLoadProgress(CORE_ASSETS.length, LOAD_STEPS, UPDATE_STEP_NAME);
    const updatePromise = runStartupUpdateCheck();
    const elapsed = performance.now() - started;
    const minLeft = Math.max(0, MIN_STARTUP_MS - elapsed);
    let info = null;
    let timedOut = false;
    let settled = false;
    await Promise.all([
      Promise.race([
        updatePromise.then((value) => {
          if (settled) return;
          settled = true;
          info = value;
        }),
        wait(UPDATE_CHECK_BUDGET_MS).then(() => {
          if (settled) return;
          settled = true;
          timedOut = true;
        }),
      ]),
      minLeft > 20 ? wait(minLeft) : Promise.resolve(),
    ]);
    window.__startupUpdateInfo = info;
    window.__startupUpdateChecked = true;
    if (timedOut && info == null) {
      updatePromise.then((late) => {
        window.__startupUpdateInfo = late;
        if (late?.update && typeof window.showUpdateModal === "function" && !window.__sspSoftlocked) {
          window.showUpdateModal(late);
        }
      });
    }
    setLoadProgress(LOAD_STEPS, LOAD_STEPS, "");
    return info;
  }

  async function loadReturnHomeFast() {
    const priority = CORE_ASSETS.filter((asset) => RETURN_FAST_URLS.has(asset.url));
    const deferred = CORE_ASSETS.filter((asset) => !RETURN_FAST_URLS.has(asset.url));

    await Promise.all(priority.filter((asset) => asset.kind === "css").map(loadAsset));
    for (const asset of priority.filter((asset) => asset.kind === "js")) {
      await loadAsset(asset);
    }
    await Promise.all(deferred.map(loadAsset));
  }

  async function start() {
    const splash = $("openingSplash");
    const shell = document.querySelector(".launcher-shell");
    const pendingNav = sessionStorage.getItem("vizTransitionDir");
    const started = performance.now();

    if (pendingNav) {
      splash?.remove();
      await loadReturnHomeFast();
      runStartupUpdateCheck().then((info) => {
        window.__startupUpdateInfo = info;
        window.__startupUpdateChecked = true;
      });
      return;
    }

    splash?.classList.add("active");
    splash?.setAttribute("aria-hidden", "false");
    await loadCoreAssets();
    await finishWithUpdateCheck(started);
    splash?.classList.add("hide");
    shell?.classList.remove("opening-pending");
    await wait(prefersReducedMotion() ? 50 : 120);
    splash?.remove();
  }

  start();
})();
