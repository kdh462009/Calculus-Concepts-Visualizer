(function bootHome() {
  const MIN_STARTUP_MS = 2000;

  const CORE_ASSETS = [
    { name: "styles.css", url: "../core/styles.css", kind: "css" },
    { name: "transitions.css", url: "../core/transitions.css", kind: "css" },
    { name: "transitions.js", url: "../core/transitions.js", kind: "js" },
    { name: "graph.js", url: "../core/graph.js", kind: "js" },
    { name: "function-preview.js", url: "../core/function-preview.js", kind: "js" },
    { name: "nav.js", url: "../core/nav.js", kind: "js" },
    { name: "home/app.js", url: "./app.js", kind: "js" },
  ];

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
      script.onload = finish;
      script.onerror = finish;
      document.body.appendChild(script);
    });
  }

  function setLoadProgress(done, total, currentName) {
    const fill = $("openingLoadFill");
    const label = $("openingLoadLabel");
    const list = $("openingLoadList");
    if (fill) fill.style.width = `${Math.round((done / total) * 100)}%`;
    if (label) label.textContent = currentName ? `Loading ${currentName}` : "Ready";
    if (!list) return;
    list.querySelectorAll("li").forEach((item, index) => {
      item.classList.toggle("is-done", index < done);
      item.classList.toggle("is-active", Boolean(currentName) && index === done);
    });
  }

  function paintLoadList() {
    const list = $("openingLoadList");
    if (!list) return;
    list.replaceChildren(
      ...CORE_ASSETS.map((asset) => {
        const li = document.createElement("li");
        li.textContent = asset.name;
        return li;
      }),
    );
  }

  async function loadCoreAssets(minMs) {
    paintLoadList();
    const started = performance.now();
    const slice = minMs > 0 ? minMs / CORE_ASSETS.length : 0;

    for (let i = 0; i < CORE_ASSETS.length; i += 1) {
      const asset = CORE_ASSETS[i];
      setLoadProgress(i, CORE_ASSETS.length, asset.name);
      const tasks = [loadAsset(asset)];
      if (slice > 0) tasks.push(wait(slice));
      await Promise.all(tasks);
    }

    setLoadProgress(CORE_ASSETS.length, CORE_ASSETS.length, "");
    const leftover = minMs - (performance.now() - started);
    if (leftover > 40) await wait(leftover);
  }

  async function start() {
    const splash = $("openingSplash");
    const shell = document.querySelector(".launcher-shell");
    const pendingNav = sessionStorage.getItem("vizTransitionDir");

    if (pendingNav) {
      shell?.classList.remove("opening-pending");
      splash?.remove();
      await loadCoreAssets(0);
      return;
    }

    splash?.classList.add("active");
    splash?.setAttribute("aria-hidden", "false");
    await loadCoreAssets(MIN_STARTUP_MS);
    splash?.classList.add("hide");
    shell?.classList.remove("opening-pending");
    await wait(prefersReducedMotion() ? 80 : 240);
    splash?.remove();
  }

  start();
})();
