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

/** Turn $...$ math islands into native-looking inline math (not LaTeX). */
function formatSubtitle(text) {
  const parts = String(text || "").split(/(\$[^$]+\$)/g);
  return parts.map((part) => {
    if (part.startsWith("$") && part.endsWith("$") && part.length > 2) {
      return `<span class="math">${formatMathIsland(part.slice(1, -1))}</span>`;
    }
    return escapeHtml(part);
  }).join("");
}

function formatMathIsland(raw) {
  let html = escapeHtml(raw);
  const slots = [];
  const stash = (markup) => {
    const key = `\uE000${slots.length}\uE001`;
    slots.push(markup);
    return key;
  };
  // Keep differential operators and summation/product upright.
  html = html.replace(/(^|[^A-Za-zΑ-Ωα-ω])d([xyztrθϕ])(?![A-Za-zΑ-Ωα-ω])/g, (_, pre, v) => (
    `${pre}${stash(`<span class="math-op">d</span><i>${v}</i>`)}`
  ));
  html = html.replace(/[ΣΠ]/g, (op) => stash(`<span class="math-op">${op}</span>`));
  // Italicize variables (before any remaining tags are introduced).
  html = html.replace(
    /([A-Za-zΑ-Ωα-ωϑϕϖϱϵ])([′″‴⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻ⁿₐₑₒₓₕₖₗₘₙₚₛₜ]*)/g,
    "<i>$1</i>$2",
  );
  // _{...} / _n and ^{...} / ^n → sub/superscript (may wrap <i> tags)
  const scriptAtom = "(?:<i>[^<]+</i>|[0-9ιθϕn])";
  html = html.replace(/_\{([^}]+)\}/g, "<sub>$1</sub>");
  html = html.replace(new RegExp(`_((?:${scriptAtom})+)`, "g"), "<sub>$1</sub>");
  html = html.replace(/\^\{([^}]+)\}/g, "<sup>$1</sup>");
  html = html.replace(new RegExp(`\\^((?:${scriptAtom})+)`, "g"), "<sup>$1</sup>");
  slots.forEach((markup, i) => {
    html = html.replace(`\uE000${i}\uE001`, markup);
  });
  return html;
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function playCardPress(card) {
  if (!card || prefersReducedMotion()) return;
  card.classList.remove("is-pressing");
  // Force reflow so re-triggering the animation works on rapid opens.
  void card.offsetWidth;
  card.classList.add("is-pressing");
  await Promise.race([
    wait(220),
    new Promise((resolve) => {
      card.addEventListener("animationend", resolve, { once: true });
    }),
  ]);
}

async function openVisualizer(viz, card) {
  await playCardPress(card);
  VizTransition.navigateWithWoosh(VizTransition.forward, () => {
    return window.pywebview.api.open_visualizer(viz.id);
  });
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
        <span class="viz-card-sub">${formatSubtitle(viz.subtitle)}</span>
      </span>
      <span class="viz-card-go">Open</span>
      ${viz.beta ? '<span class="beta-badge beta-badge--card" data-tip="Production testing is live" tabindex="0">Beta</span>' : ""}
    `;
    card.addEventListener("click", () => {
      hub.cardIndex = index;
      openVisualizer(viz, card);
    });
    if (viz.beta) {
      const badge = card.querySelector(".beta-badge");
      badge?.addEventListener("click", (event) => event.stopPropagation());
      badge?.addEventListener("mousedown", (event) => event.stopPropagation());
    }
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
  const card = document.querySelectorAll(".viz-card")[hub.cardIndex];
  if (viz) openVisualizer(viz, card);
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
  maybeEnforceSupportOrUpdate();
}

let pendingUpdate = null;
let updateSupportTimerId = null;
let updateSupportExpiresAtMs = null;

function formatSupportDuration(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  const clock = `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  if (days > 0) return `${days}d ${clock}`;
  return clock;
}

function stopUpdateSupportTimer() {
  if (updateSupportTimerId) {
    clearInterval(updateSupportTimerId);
    updateSupportTimerId = null;
  }
  updateSupportExpiresAtMs = null;
}

function tickUpdateSupportTimer() {
  const el = document.getElementById("updateSupportTimer");
  if (!el || updateSupportExpiresAtMs == null) return;
  const remaining = updateSupportExpiresAtMs - Date.now();
  if (remaining <= 0) {
    el.hidden = false;
    el.textContent = "SSP support window ended — update required";
    stopUpdateSupportTimer();
    if (typeof window.enforceSupportWindow === "function") {
      window.enforceSupportWindow();
    }
    return;
  }
  el.hidden = false;
  el.textContent = `SSP coverage ends in ${formatSupportDuration(remaining)}`;
}

function startUpdateSupportTimer(expiresOn) {
  stopUpdateSupportTimer();
  const el = document.getElementById("updateSupportTimer");
  const raw = String(expiresOn || "").trim();
  if (!el || !raw) {
    if (el) el.hidden = true;
    return;
  }
  const parsed = new Date(`${raw}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    el.hidden = true;
    return;
  }
  updateSupportExpiresAtMs = parsed.getTime();
  tickUpdateSupportTimer();
  updateSupportTimerId = setInterval(tickUpdateSupportTimer, 1000);
}

function hideUpdateModal() {
  if (window.__sspSoftlocked) return;
  const modal = document.getElementById("updateModal");
  if (modal) modal.hidden = true;
  pendingUpdate = null;
  stopUpdateSupportTimer();
  const timer = document.getElementById("updateSupportTimer");
  if (timer) timer.hidden = true;
}

async function showUpdateModal(info) {
  if (window.__sspSoftlocked) return;
  pendingUpdate = info;
  const modal = document.getElementById("updateModal");
  if (!modal) return;
  const latest = document.getElementById("updateLatest");
  const current = document.getElementById("updateCurrent");
  const instructions = document.getElementById("updateInstructions");
  if (latest) latest.textContent = info.latestVersion || "—";
  if (current) current.textContent = info.currentVersion || "—";
  if (instructions) {
    instructions.textContent = info.instructions
      || "Download the latest version and replace your current application with it.";
  }

  let expiresOn = info.supportExpiresOn || info.expiresOn || null;
  if (!expiresOn) {
    try {
      const support = await window.pywebview?.api?.check_support_status?.();
      expiresOn = support?.expiresOn || null;
    } catch {
      /* ignore */
    }
  }
  startUpdateSupportTimer(expiresOn);
  modal.hidden = false;
}

window.showUpdateModal = showUpdateModal;
window.hideUpdateModal = hideUpdateModal;

async function maybeEnforceSupportOrUpdate() {
  try {
    if (typeof window.enforceSupportWindow === "function") {
      const locked = await window.enforceSupportWindow();
      if (locked) return;
    }
  } catch {
    /* softlock check failed — still try update offer */
  }
  await maybeOfferUpdate();
}

async function waitForStartupUpdate(timeoutMs = 2500) {
  if (window.__startupUpdateChecked) return window.__startupUpdateInfo || null;
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (window.__startupUpdateChecked) return window.__startupUpdateInfo || null;
    await wait(40);
  }
  return window.__startupUpdateInfo || null;
}

async function maybeOfferUpdate() {
  try {
    if (window.__sspSoftlocked) return;
    try {
      if (sessionStorage.getItem("cvAutoUpdateChecked") === "1") return;
    } catch {
      /* private mode */
    }
    let info = await waitForStartupUpdate();
    if (!info && !window.__startupUpdateChecked) {
      if (!window.pywebview?.api?.check_for_update) return;
      const checker = window.checkForUpdateWithRetry || (() => window.pywebview.api.check_for_update());
      info = await checker(2);
    }
    try {
      sessionStorage.setItem("cvAutoUpdateChecked", "1");
    } catch {
      /* ignore */
    }
    if (!info?.update) return;
    showUpdateModal(info);
  } catch {
    /* offline / bridge — fail silently */
  }
}

function wireUpdateModal() {
  const modal = document.getElementById("updateModal");
  if (!modal) return;
  modal.querySelectorAll("[data-update-dismiss]").forEach((node) => {
    node.addEventListener("click", () => hideUpdateModal());
  });
  document.getElementById("updateLaterBtn")?.addEventListener("click", () => hideUpdateModal());
  document.getElementById("updateDownloadBtn")?.addEventListener("click", async () => {
    const url = pendingUpdate?.downloadUrl || "";
    try {
      await window.pywebview.api.open_update_download(url);
    } catch {
      /* ignore */
    }
    if (!window.__sspSoftlocked) hideUpdateModal();
  });
  document.getElementById("updateChangelogBtn")?.addEventListener("click", async () => {
    const url = pendingUpdate?.releaseUrl
      || pendingUpdate?.downloadUrl
      || "https://github.com/kdh462009/Calculus-Concepts-Visualizer/releases/latest";
    try {
      await window.pywebview.api.open_update_download(url);
    } catch {
      /* ignore */
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modal && !modal.hidden && !window.__sspSoftlocked) {
      hideUpdateModal();
    }
  });
}

async function syncDisplayedVersion() {
  try {
    const res = await window.pywebview.api.get_app_version?.();
    const version = res?.version;
    if (!version) return;
    window.APP_VERSION = version;
    document.querySelectorAll("[data-app-version]").forEach((node) => {
      node.textContent = `Version ${version}`;
    });
    const changelogUrl = res.changelogUrl
      || (typeof changelogHrefFor === "function" ? changelogHrefFor(version) : null);
    if (changelogUrl) {
      document.querySelectorAll("[data-app-changelog]").forEach((node) => {
        node.setAttribute("href", changelogUrl);
      });
    }
  } catch {
    /* ignore */
  }
}

whenApiReady(() => {
  wireUpdateModal();
  syncDisplayedVersion();
  bootstrap();
});
