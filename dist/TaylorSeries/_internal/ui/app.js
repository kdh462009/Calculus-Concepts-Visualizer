const state = {
  data: null,
  animating: false,
  paused: false,
  rafId: null,
  termIndex: 0,
  elapsedInTerm: 0,
  lastTs: 0,
  dragActive: false,
  dragStart: null,
  view: { xmin: -4, xmax: 4, ymin: -6, ymax: 6 },
  activeParams: null,
  domainExpandTimer: null,
  domainExpandInFlight: false,
};

const el = {};

function $(id) {
  return document.getElementById(id);
}

function setStatus(text) {
  el.status.textContent = text;
}

function setTermCounter(text) {
  el.termCounter.textContent = text;
}

function easeGravity(t) {
  if (t < 0.72) {
    return ((t / 0.72) ** 2) * 0.82;
  }
  const tail = (t - 0.72) / 0.28;
  return 0.82 + (1 - (1 - tail) ** 3) * 0.18;
}

function finiteOrNull(v) {
  return Number.isFinite(v) ? v : null;
}

function currentDisplayedCurve() {
  if (!state.data) return null;
  const partials = state.data.partials;
  if (!partials || !partials.length) return null;
  const idx = Math.min(state.termIndex, partials.length - 1);
  if (idx < partials.length - 1 && state.animating && !state.paused) {
    const speed = Number(el.speedInput.value);
    const progress = speed > 0 ? Math.max(0, Math.min(1, state.elapsedInTerm / speed)) : 1;
    return blendedCurve(partials[idx], partials[idx + 1], easeGravity(progress));
  }
  return partials[idx];
}

function blendedCurve(curA, curB, t) {
  const out = new Array(curA.length);
  for (let i = 0; i < curA.length; i += 1) {
    const a = curA[i];
    const b = curB[i];
    if (a === null || b === null) {
      out[i] = null;
    } else {
      out[i] = a * (1 - t) + b * t;
    }
  }
  return out;
}

function setupCanvasResolution() {
  const dpr = window.devicePixelRatio || 1;
  const rect = el.canvas.getBoundingClientRect();
  const w = Math.max(400, Math.floor(rect.width * dpr));
  const h = Math.max(320, Math.floor(rect.height * dpr));
  if (el.canvas.width !== w || el.canvas.height !== h) {
    el.canvas.width = w;
    el.canvas.height = h;
  }
}

function worldToScreen(x, y) {
  const { xmin, xmax, ymin, ymax } = state.view;
  const w = el.canvas.width;
  const h = el.canvas.height;
  const sx = ((x - xmin) / (xmax - xmin)) * w;
  const sy = h - ((y - ymin) / (ymax - ymin)) * h;
  return [sx, sy];
}

function screenToWorld(sx, sy) {
  const { xmin, xmax, ymin, ymax } = state.view;
  const w = el.canvas.width;
  const h = el.canvas.height;
  const x = xmin + (sx / w) * (xmax - xmin);
  const y = ymin + ((h - sy) / h) * (ymax - ymin);
  return [x, y];
}

function drawLine(xs, ys, color, width = 2.6, alpha = 1.0) {
  const ctx = el.ctx;
  ctx.strokeStyle = color;
  ctx.lineWidth = width * (window.devicePixelRatio || 1);
  ctx.globalAlpha = alpha;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  let drawing = false;
  ctx.beginPath();
  for (let i = 0; i < xs.length; i += 1) {
    const y = ys[i];
    if (y === null) {
      drawing = false;
      continue;
    }
    const [sx, sy] = worldToScreen(xs[i], y);
    if (!drawing) {
      ctx.moveTo(sx, sy);
      drawing = true;
    } else {
      ctx.lineTo(sx, sy);
    }
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawGrid() {
  const ctx = el.ctx;
  const w = el.canvas.width;
  const h = el.canvas.height;

  ctx.clearRect(0, 0, w, h);

  const grad = ctx.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, "#1d2742");
  grad.addColorStop(1, "#131c33");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = "rgba(90, 109, 161, 0.40)";
  ctx.lineWidth = 1;
  const { xmin, xmax, ymin, ymax } = state.view;
  const stepX = (xmax - xmin) / 10;
  const stepY = (ymax - ymin) / 8;

  for (let gx = xmin; gx <= xmax; gx += stepX) {
    const [sx] = worldToScreen(gx, ymin);
    ctx.beginPath();
    ctx.moveTo(sx, 0);
    ctx.lineTo(sx, h);
    ctx.stroke();
  }
  for (let gy = ymin; gy <= ymax; gy += stepY) {
    const [, sy] = worldToScreen(xmin, gy);
    ctx.beginPath();
    ctx.moveTo(0, sy);
    ctx.lineTo(w, sy);
    ctx.stroke();
  }

  const [x0] = worldToScreen(0, ymin);
  const [, y0] = worldToScreen(xmin, 0);
  ctx.strokeStyle = "rgba(188, 200, 240, 0.7)";
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(x0, 0);
  ctx.lineTo(x0, h);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, y0);
  ctx.lineTo(w, y0);
  ctx.stroke();
}

function drawCurrentFrame(currentApproxCurve) {
  if (!state.data) return;
  setupCanvasResolution();
  drawGrid();
  drawLine(state.data.x, state.data.yTrue, "#2ee8bb", 2.5, 0.74);
  drawLine(state.data.x, currentApproxCurve, "#372061", 3.15, 1.0);
}

function stopAnimation() {
  state.animating = false;
  state.paused = false;
  state.lastTs = 0;
  if (state.rafId) cancelAnimationFrame(state.rafId);
  state.rafId = null;
  el.pauseBtn.textContent = "⏸ PAUSE";
}

function scheduleDomainExpansion() {
  if (!state.data || !state.activeParams) return;
  if (state.domainExpandTimer) clearTimeout(state.domainExpandTimer);
  state.domainExpandTimer = setTimeout(ensureDomainCoverage, 180);
}

async function ensureDomainCoverage() {
  if (!state.data || !state.activeParams || state.domainExpandInFlight) return;
  const [domainMin, domainMax] = state.data.xRange;
  const { xmin, xmax } = state.view;
  if (xmin >= domainMin && xmax <= domainMax) return;

  const span = xmax - xmin;
  const pad = Math.max(0.5, span * 0.2);
  const reqMin = Math.min(xmin, domainMin) - pad;
  const reqMax = Math.max(xmax, domainMax) + pad;

  state.domainExpandInFlight = true;
  const payload = {
    ...state.activeParams,
    xmin: reqMin,
    xmax: reqMax,
  };
  const result = await window.pywebview.api.compute(payload);
  state.domainExpandInFlight = false;
  if (!result || !result.ok) return;

  state.data = result;
  state.termIndex = Math.min(state.termIndex, Math.max(0, result.termCount - 1));
  drawCurrentFrame(currentDisplayedCurve());
}

function loop(ts) {
  if (!state.animating || !state.data) return;
  if (state.paused) {
    state.lastTs = ts;
    state.rafId = requestAnimationFrame(loop);
    return;
  }

  if (!state.lastTs) state.lastTs = ts;
  const dt = ts - state.lastTs;
  state.lastTs = ts;

  const speed = Number(el.speedInput.value);
  const partials = state.data.partials;
  const maxTerm = partials.length - 1;

  if (state.termIndex < maxTerm) {
    state.elapsedInTerm += dt;
    while (state.elapsedInTerm >= speed && state.termIndex < maxTerm) {
      state.elapsedInTerm -= speed;
      state.termIndex += 1;
    }
  }

  let curve = partials[state.termIndex];
  let displayTerm = state.termIndex + 1;

  if (state.termIndex < maxTerm) {
    const progress = Math.max(0, Math.min(1, state.elapsedInTerm / speed));
    const eased = easeGravity(progress);
    curve = blendedCurve(partials[state.termIndex], partials[state.termIndex + 1], eased);
    displayTerm = state.termIndex + 1 + (eased > 0.999 ? 1 : 0);
  }

  drawCurrentFrame(curve);
  setStatus(`animating... term ${Math.min(displayTerm, partials.length)}`);
  setTermCounter(`term ${Math.min(displayTerm, partials.length)} / ${partials.length}`);

  if (state.termIndex >= maxTerm && state.elapsedInTerm >= speed) {
    stopAnimation();
    setStatus("animation complete.");
    return;
  }

  state.rafId = requestAnimationFrame(loop);
}

function resetViewFromData() {
  if (!state.data) return;
  state.view = {
    xmin: state.data.xRange[0],
    xmax: state.data.xRange[1],
    ymin: state.data.yRange[0],
    ymax: state.data.yRange[1],
  };
}

async function runAnimation() {
  const payload = {
    expr: el.exprInput.value.trim(),
    center: Number(el.centerInput.value),
    terms: Number(el.termsInput.value),
    xmin: Number(el.xminInput.value),
    xmax: Number(el.xmaxInput.value),
    samples: 1400,
  };
  setStatus("computing series...");

  const result = await window.pywebview.api.compute(payload);
  if (!result.ok) {
    setStatus(`error: ${result.error}`);
    return;
  }

  state.data = result;
  state.activeParams = { ...payload };
  state.termIndex = 0;
  state.elapsedInTerm = 0;
  state.lastTs = 0;
  resetViewFromData();
  el.latexImage.src = result.latexPng;
  stopAnimation();
  state.animating = true;
  setStatus("animating...");
  setTermCounter(`term 1 / ${result.termCount}`);
  el.pauseBtn.textContent = "⏸ PAUSE";
  state.rafId = requestAnimationFrame(loop);
}

function wireInteractions() {
  el.animateBtn.addEventListener("click", runAnimation);

  el.pauseBtn.addEventListener("click", () => {
    if (!state.animating) {
      setStatus("nothing to pause. press ANIMATE first.");
      return;
    }
    state.paused = !state.paused;
    el.pauseBtn.textContent = state.paused ? "▶ RESUME" : "⏸ PAUSE";
    setStatus(state.paused ? "paused." : "resumed.");
  });

  el.resetBtn.addEventListener("click", () => {
    stopAnimation();
    state.data = null;
    state.activeParams = null;
    if (state.domainExpandTimer) {
      clearTimeout(state.domainExpandTimer);
      state.domainExpandTimer = null;
    }
    state.view = { xmin: -4, xmax: 4, ymin: -6, ymax: 6 };
    drawGrid();
    el.latexImage.src = "";
    setStatus("reset.");
    setTermCounter("");
  });

  el.termsInput.addEventListener("input", () => {
    el.termsValue.textContent = el.termsInput.value;
  });
  el.speedInput.addEventListener("input", () => {
    el.speedValue.textContent = `${el.speedInput.value} ms`;
  });

  el.canvas.addEventListener("mousedown", (e) => {
    state.dragActive = true;
    state.dragStart = { x: e.clientX, y: e.clientY, view: { ...state.view } };
    el.canvas.style.cursor = "grabbing";
  });
  window.addEventListener("mouseup", () => {
    state.dragActive = false;
    el.canvas.style.cursor = "crosshair";
  });
  window.addEventListener("mousemove", (e) => {
    if (!state.dragActive) return;
    const dx = e.clientX - state.dragStart.x;
    const dy = e.clientY - state.dragStart.y;
    const w = el.canvas.getBoundingClientRect().width;
    const h = el.canvas.getBoundingClientRect().height;
    const xv = state.dragStart.view.xmax - state.dragStart.view.xmin;
    const yv = state.dragStart.view.ymax - state.dragStart.view.ymin;
    state.view.xmin = state.dragStart.view.xmin - (dx / w) * xv;
    state.view.xmax = state.dragStart.view.xmax - (dx / w) * xv;
    state.view.ymin = state.dragStart.view.ymin + (dy / h) * yv;
    state.view.ymax = state.dragStart.view.ymax + (dy / h) * yv;
    if (state.data) {
      drawCurrentFrame(currentDisplayedCurve());
      scheduleDomainExpansion();
    } else {
      drawGrid();
    }
  });

  el.canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const zoom = e.deltaY > 0 ? 1.08 : 0.92;
    const rect = el.canvas.getBoundingClientRect();
    const sx = (e.clientX - rect.left) * (window.devicePixelRatio || 1);
    const sy = (e.clientY - rect.top) * (window.devicePixelRatio || 1);
    const [wx, wy] = screenToWorld(sx, sy);
    state.view.xmin = wx + (state.view.xmin - wx) * zoom;
    state.view.xmax = wx + (state.view.xmax - wx) * zoom;
    state.view.ymin = wy + (state.view.ymin - wy) * zoom;
    state.view.ymax = wy + (state.view.ymax - wy) * zoom;
    if (state.data) {
      drawCurrentFrame(currentDisplayedCurve());
      scheduleDomainExpansion();
    } else {
      drawGrid();
    }
  }, { passive: false });

  window.addEventListener("resize", () => {
    if (state.data) {
      drawCurrentFrame(currentDisplayedCurve());
    } else {
      drawGrid();
    }
  });
}

async function bootstrap() {
  el.exprInput = $("exprInput");
  el.centerInput = $("centerInput");
  el.termsInput = $("termsInput");
  el.speedInput = $("speedInput");
  el.xminInput = $("xminInput");
  el.xmaxInput = $("xmaxInput");
  el.animateBtn = $("animateBtn");
  el.pauseBtn = $("pauseBtn");
  el.resetBtn = $("resetBtn");
  el.status = $("status");
  el.termCounter = $("termCounter");
  el.latexImage = $("latexImage");
  el.termsValue = $("termsValue");
  el.speedValue = $("speedValue");
  el.canvas = $("plotCanvas");
  el.ctx = el.canvas.getContext("2d");

  const boot = await window.pywebview.api.get_bootstrap();
  const hints = $("functionHints");
  boot.hints.forEach((h) => {
    const op = document.createElement("option");
    op.value = h;
    hints.appendChild(op);
  });

  const presets = $("presets");
  boot.presets.forEach(([label, expr]) => {
    const btn = document.createElement("button");
    btn.className = "preset-btn";
    btn.textContent = label;
    btn.addEventListener("click", () => {
      el.exprInput.value = expr;
      setStatus(`preset: ${expr}`);
    });
    presets.appendChild(btn);
  });

  wireInteractions();
  drawGrid();
}

window.addEventListener("pywebviewready", bootstrap);
