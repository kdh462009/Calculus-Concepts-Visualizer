function $(id) {
  return document.getElementById(id);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function groupByUnit(items) {
  const groups = new Map();
  items.forEach((viz) => {
    const key = `${viz.unit}|${viz.unitTitle}`;
    if (!groups.has(key)) {
      groups.set(key, {
        unit: viz.unit,
        unitTitle: viz.unitTitle,
        items: [],
      });
    }
    groups.get(key).items.push(viz);
  });
  return Array.from(groups.values()).sort((a, b) => a.unit - b.unit);
}

async function playOpeningIntro() {
  const splash = $("openingSplash");
  const shell = document.querySelector(".launcher-shell");
  if (!splash || !shell) return;

  if (prefersReducedMotion() || sessionStorage.getItem("calcbcOpeningDone")) {
    shell.classList.remove("opening-pending");
    splash.remove();
    return;
  }

  sessionStorage.setItem("calcbcOpeningDone", "1");
  splash.classList.add("active");
  splash.setAttribute("aria-hidden", "false");
  await wait(1150);

  splash.classList.add("hide");
  shell.classList.remove("opening-pending");
  await wait(420);
  splash.remove();
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function createUnitNode(group, expanded = true, staggerIndex = 0) {
  const li = document.createElement("li");
  li.className = `tree-unit${expanded ? " tree-unit-open" : ""}`;

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "tree-unit-btn";
  toggle.setAttribute("aria-expanded", expanded ? "true" : "false");
  toggle.innerHTML = `
    <span class="tree-chevron">▾</span>
    <span class="tree-unit-label">Unit ${group.unit}</span>
    <span class="tree-unit-title">${escapeHtml(group.unitTitle)}</span>
    <span class="tree-unit-count">${group.items.length}</span>
  `;

  const wrap = document.createElement("div");
  wrap.className = `tree-children-wrap${expanded ? " is-open" : ""}`;

  const children = document.createElement("ul");
  children.className = "tree-children";

  group.items.forEach((viz, leafIndex) => {
    const leaf = document.createElement("li");
    leaf.style.setProperty("--leaf-i", String(leafIndex));
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tree-leaf";
    btn.innerHTML = `
      <span class="tree-leaf-marker">└</span>
      <span class="tree-leaf-symbol">${escapeHtml(viz.symbol)}</span>
      <span class="tree-leaf-text">
        <span class="tree-leaf-title">${escapeHtml(viz.title)}</span>
        <span class="tree-leaf-sub">${escapeHtml(viz.subtitle)}</span>
      </span>
    `;
    btn.addEventListener("click", async () => {
      await VizTransition.navigateWithWoosh(VizTransition.forward, () => {
        window.pywebview.api.open_visualizer(viz.id);
      });
    });
    leaf.appendChild(btn);
    children.appendChild(leaf);
  });

  wrap.appendChild(children);

  toggle.addEventListener("click", () => {
    const open = toggle.getAttribute("aria-expanded") !== "true";
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    wrap.classList.toggle("is-open", open);
    li.classList.toggle("tree-unit-open", open);
    if (open) {
      wrap.querySelectorAll(".tree-leaf").forEach((leafBtn, i) => {
        leafBtn.classList.remove("tree-leaf-replay");
        void leafBtn.offsetWidth;
        leafBtn.style.animationDelay = `${0.04 + i * 0.05}s`;
        leafBtn.classList.add("tree-leaf-replay");
      });
    }
  });

  li.appendChild(toggle);
  li.appendChild(wrap);
  return li;
}

async function bootstrap() {
  const pendingNav = sessionStorage.getItem("vizTransitionDir");
  if (!pendingNav) {
    await playOpeningIntro();
  } else {
    document.querySelector(".launcher-shell")?.classList.remove("opening-pending");
    $("openingSplash")?.remove();
  }

  VizTransition.initPageTransition();

  const root = $("vizTree");
  const items = await window.pywebview.api.get_visualizers();
  const groups = groupByUnit(items);

  groups.forEach((group, index) => {
    root.appendChild(createUnitNode(group, true, index));
  });
}

whenApiReady(bootstrap);
