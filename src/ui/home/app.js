function $(id) {
  return document.getElementById(id);
}

const UNIT_CHIP = {
  1: "Limits",
  2: "Derivatives",
  3: "Inverse",
  6: "Integrals",
  8: "Volume",
  9: "Para / Polar",
  10: "Series",
};

const SELECTED_UNIT_KEY = "calcbcSelectedUnit";

const hub = {
  groups: [],
  unit: 1,
  cardIndex: -1,
};

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

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function currentGroup() {
  return hub.groups.find((group) => group.unit === hub.unit) || hub.groups[0];
}

function resolveSelectedUnit(groups) {
  const stored = Number(sessionStorage.getItem(SELECTED_UNIT_KEY));
  if (groups.some((group) => group.unit === stored)) return stored;
  return groups[0]?.unit ?? 1;
}

function openVisualizer(viz) {
  VizTransition.navigateWithWoosh(VizTransition.forward, () => {
    window.pywebview.api.open_visualizer(viz.id);
  });
}

function applyHubFocus() {
  const activeChip = document.querySelector(".unit-chip.is-active");
  const cards = [...document.querySelectorAll(".viz-card")];
  cards.forEach((card, index) => {
    const on = index === hub.cardIndex;
    card.classList.toggle("is-focused", on);
    card.setAttribute("aria-selected", on ? "true" : "false");
  });
  if (hub.cardIndex >= 0 && cards[hub.cardIndex]) {
    cards[hub.cardIndex].focus();
    return;
  }
  activeChip?.focus();
}

function renderHub() {
  const rail = $("unitRail");
  const stage = $("vizStage");
  if (!rail || !stage) return;

  rail.replaceChildren();
  hub.groups.forEach((group) => {
    const active = group.unit === hub.unit;
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = `unit-chip${active ? " is-active" : ""}`;
    chip.setAttribute("role", "tab");
    chip.setAttribute("aria-selected", active ? "true" : "false");
    chip.setAttribute("aria-controls", "vizStage");
    chip.dataset.unit = String(group.unit);
    chip.innerHTML = `
      <span class="unit-chip-num">${group.unit}</span>
      <span class="unit-chip-name">${escapeHtml(UNIT_CHIP[group.unit] || group.unitTitle)}</span>
    `;
    chip.addEventListener("click", () => selectUnit(group.unit, -1));
    rail.appendChild(chip);
  });

  const group = currentGroup();
  if (!group) return;

  const maxIndex = group.items.length - 1;
  if (hub.cardIndex > maxIndex) hub.cardIndex = maxIndex;

  stage.setAttribute("aria-label", `Unit ${group.unit}: ${group.unitTitle}`);
  const heading = document.createElement("p");
  heading.className = "unit-heading";
  heading.innerHTML = `<span>Unit ${group.unit}</span> ${escapeHtml(group.unitTitle)}`;

  const grid = document.createElement("div");
  grid.className = "viz-card-grid";
  if (group.items.length === 1) grid.classList.add("is-single");

  group.items.forEach((viz, index) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "viz-card";
    card.style.setProperty("--card-i", String(index));
    card.setAttribute("aria-selected", "false");
    card.innerHTML = `
      <span class="viz-card-symbol">${escapeHtml(viz.symbol)}</span>
      <span class="viz-card-body">
        <span class="viz-card-title">${escapeHtml(viz.title)}</span>
        <span class="viz-card-sub">${escapeHtml(viz.subtitle)}</span>
      </span>
      <span class="viz-card-go">Open</span>
    `;
    card.addEventListener("click", () => {
      hub.cardIndex = index;
      openVisualizer(viz);
    });
    grid.appendChild(card);
  });

  stage.replaceChildren(heading, grid);
  applyHubFocus();
}

function selectUnit(unit, cardIndex = -1) {
  hub.unit = unit;
  hub.cardIndex = cardIndex;
  sessionStorage.setItem(SELECTED_UNIT_KEY, String(unit));
  renderHub();
}

function moveUnit(delta) {
  const units = hub.groups.map((group) => group.unit);
  const index = Math.max(0, units.indexOf(hub.unit));
  const next = units[(index + delta + units.length) % units.length];
  selectUnit(next, -1);
}

function moveCard(delta) {
  const group = currentGroup();
  if (!group?.items.length) return;
  const last = group.items.length - 1;
  if (hub.cardIndex < 0 && delta < 0) return;
  if (hub.cardIndex < 0 && delta > 0) {
    hub.cardIndex = 0;
  } else {
    hub.cardIndex = Math.max(-1, Math.min(last, hub.cardIndex + delta));
  }
  applyHubFocus();
}

function openFocusedCard() {
  const group = currentGroup();
  if (!group || hub.cardIndex < 0) return;
  const viz = group.items[hub.cardIndex];
  if (viz) openVisualizer(viz);
}

function isTypingTarget(target) {
  return target instanceof HTMLElement && (
    target.matches("input, textarea, select")
    || target.isContentEditable
  );
}

function wireHubKeys() {
  document.addEventListener("keydown", (event) => {
    if (event.defaultPrevented || isTypingTarget(event.target)) return;

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      moveUnit(-1);
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      moveUnit(1);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveCard(1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      moveCard(-1);
      return;
    }
    if (event.key === "Enter") {
      if (hub.cardIndex < 0) return;
      event.preventDefault();
      openFocusedCard();
    }
  });
}

async function bootstrap() {
  document.querySelector(".launcher-shell")?.classList.remove("opening-pending");

  VizTransition.initPageTransition();

  const items = await window.pywebview.api.get_visualizers();
  hub.groups = groupByUnit(items);
  hub.unit = resolveSelectedUnit(hub.groups);
  hub.cardIndex = -1;
  renderHub();
  wireHubKeys();
}

whenApiReady(bootstrap);
