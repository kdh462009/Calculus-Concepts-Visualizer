function $(id) {
  return document.getElementById(id);
}

const SELECTED_SUBJECT_KEY = "calcbcSelectedSubject";
const SELECTED_UNIT_KEY = "calcbcSelectedUnit";

const hub = {
  subjects: [],
  subjectId: "",
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

function unitStorageKey(subjectId) {
  return `${SELECTED_UNIT_KEY}:${subjectId}`;
}

function currentSubject() {
  return hub.subjects.find((subject) => subject.id === hub.subjectId) || hub.subjects[0];
}

function currentGroup() {
  return hub.groups.find((group) => group.unit === hub.unit) || hub.groups[0];
}

function unitChipName(group) {
  const chips = currentSubject()?.unitChips || {};
  return chips[String(group.unit)] || group.unitTitle;
}

function resolveSelectedSubject(subjects) {
  const stored = sessionStorage.getItem(SELECTED_SUBJECT_KEY);
  if (subjects.some((subject) => subject.id === stored)) return stored;
  return subjects[0]?.id || "";
}

function resolveSelectedUnit(groups, subjectId) {
  const stored = Number(sessionStorage.getItem(unitStorageKey(subjectId)));
  if (groups.some((group) => group.unit === stored)) return stored;
  return groups[0]?.unit ?? 1;
}

function loadSubject(subjectId, cardIndex = -1) {
  const subject = hub.subjects.find((item) => item.id === subjectId) || hub.subjects[0];
  if (!subject) return;
  hub.subjectId = subject.id;
  hub.groups = groupByUnit(subject.visualizers || []);
  hub.unit = resolveSelectedUnit(hub.groups, subject.id);
  hub.cardIndex = cardIndex;
  sessionStorage.setItem(SELECTED_SUBJECT_KEY, subject.id);
}

function openVisualizer(viz) {
  VizTransition.navigateWithWoosh(VizTransition.forward, () => {
    window.pywebview.api.open_visualizer(viz.id);
  });
}

function applyHubFocus() {
  const activeSubject = document.querySelector(".subject-tab.is-active");
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
  if (activeChip) {
    activeChip.focus();
    return;
  }
  activeSubject?.focus();
}

function renderSubjects() {
  const rail = $("subjectRail");
  if (!rail) return;
  rail.replaceChildren();
  hub.subjects.forEach((subject) => {
    const active = subject.id === hub.subjectId;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `subject-tab${active ? " is-active" : ""}`;
    btn.setAttribute("role", "tab");
    btn.setAttribute("aria-selected", active ? "true" : "false");
    btn.setAttribute("aria-controls", "hubMain");
    btn.dataset.subject = subject.id;
    btn.innerHTML = `
      <span class="subject-tab-symbol">${escapeHtml(subject.symbol || "")}</span>
      <span class="subject-tab-copy">
        <span class="subject-tab-title">${escapeHtml(subject.title)}</span>
        <span class="subject-tab-sub">${escapeHtml(subject.subtitle || "")}</span>
      </span>
    `;
    btn.addEventListener("click", () => selectSubject(subject.id));
    rail.appendChild(btn);
  });
}

function renderUnits() {
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
      <span class="unit-chip-name">${escapeHtml(unitChipName(group))}</span>
    `;
    chip.addEventListener("click", () => selectUnit(group.unit, -1));
    rail.appendChild(chip);
  });

  const group = currentGroup();
  if (!group) {
    const empty = document.createElement("p");
    empty.className = "hub-empty";
    empty.textContent = "No visualizers in this subject yet.";
    stage.replaceChildren(empty);
    return;
  }

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
}

function renderHub() {
  renderSubjects();
  renderUnits();
  applyHubFocus();
}

function selectSubject(subjectId) {
  loadSubject(subjectId, -1);
  renderHub();
}

function selectUnit(unit, cardIndex = -1) {
  hub.unit = unit;
  hub.cardIndex = cardIndex;
  sessionStorage.setItem(unitStorageKey(hub.subjectId), String(unit));
  renderHub();
}

function moveSubject(delta) {
  const ids = hub.subjects.map((subject) => subject.id);
  const index = Math.max(0, ids.indexOf(hub.subjectId));
  const next = ids[(index + delta + ids.length) % ids.length];
  selectSubject(next);
}

function moveUnit(delta) {
  if (!hub.groups.length) return;
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

    if (event.key === "?" || (event.key === "/" && event.shiftKey)) {
      event.preventDefault();
      toggleShortcuts();
      return;
    }
    if (event.key === "[" || event.key === "PageUp") {
      event.preventDefault();
      moveSubject(-1);
      return;
    }
    if (event.key === "]" || event.key === "PageDown") {
      event.preventDefault();
      moveSubject(1);
      return;
    }
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

function setShortcutsOpen(open) {
  const panel = $("shortcutsPanel");
  const btn = $("shortcutsBtn");
  if (!panel || !btn) return;
  panel.hidden = !open;
  btn.setAttribute("aria-expanded", open ? "true" : "false");
}

function toggleShortcuts() {
  const panel = $("shortcutsPanel");
  setShortcutsOpen(Boolean(panel?.hidden));
}

function closeHomeShortcuts() {
  const panel = $("shortcutsPanel");
  if (!panel || panel.hidden) return false;
  setShortcutsOpen(false);
  return true;
}

function wireShortcuts() {
  window.closeHomeShortcuts = closeHomeShortcuts;
  $("shortcutsBtn")?.addEventListener("click", toggleShortcuts);
}

async function readCatalog() {
  const fetchCatalog = async () => {
    const catalog = await window.pywebview.api.get_catalog();
    return catalog?.subjects || [];
  };
  try {
    const subjects = await fetchCatalog();
    if (subjects.length) return subjects;
  } catch {
    /* bridge can be mid-reload after Esc; retry once */
  }
  await new Promise((resolve) => setTimeout(resolve, 180));
  try {
    return await fetchCatalog();
  } catch {
    return [];
  }
}

async function bootstrap() {
  document.querySelector(".launcher-shell")?.classList.remove("opening-pending");
  document.documentElement.classList.remove("woosh-pending-forward", "woosh-pending-back");

  VizTransition.initPageTransition();

  hub.subjects = await readCatalog();
  loadSubject(resolveSelectedSubject(hub.subjects), -1);
  renderHub();
  wireHubKeys();
  wireShortcuts();
}

whenApiReady(bootstrap);
