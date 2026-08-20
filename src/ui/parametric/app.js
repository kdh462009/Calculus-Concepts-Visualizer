const PLOT_PAD = 12;

const LEGEND_ITEMS = [
  { id: "curve", color: "#2ee8bb", label: "(x(t), y(t))" },
  { id: "velocity", color: "#f06090", label: "velocity ⟨x′, y′⟩" },
  { id: "slope", color: "#7cc7ff", label: "dy/dx" },
  { id: "speed", color: "#f5c842", label: "speed ‖v‖" },
];

const state = {
  data: null,
  params: null,
  animating: false,
  paused: false,
  rafId: null,
  elapsed: 0,
  lastTs: 0,
  progress: 0,
  phase: "curve",
  view: { xmin: -4, xmax: 4, ymin: -4, ymax: 4 },
  drag: null,
  viewLocked: false,
  snapView: { xmin: -4, xmax: 4, ymin: -4, ymax: 4 },
  hidden: new Set(),
  recomputeTimer: null,
  legendBuilt: false,
};

const el = {};
let renderer;

function $(id) {
  return document.getElementById(id);
}

function setStatus(text) {
  el.status.textContent = text;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function easeInOut(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2;
}

function phaseAtProgress(progress) {
  const p = clamp(progress, 0, 1);
  if (p < 0.25) return { phase: "curve", local: p / 0.25 };
  if (p < 0.5) return { phase: "velocity", local: (p - 0.25) / 0.25 };
  if (p < 0.75) return { phase: "slope", local: (p - 0.5) / 0.25 };
  return { phase: "speed", local: (p - 0.75) / 0.25 };
}

function layerVisible(id) {
  return !state.hidden.has(id);
}

function renderLegend() {
  if (!el.plotLegend) return;
  if (!state.data) {
    el.plotLegend.hidden = true;
    el.plotLegend.replaceChildren();
    state.legendBuilt = false;
    return;
  }
  if (state.legendBuilt && !el.plotLegend.hidden) {
    el.plotLegend.querySelectorAll(".plot-legend-item").forEach((row) => {
      const id = row.dataset.id;
      if (!id) return;
      const on = layerVisible(id);
      row.classList.toggle("is-off", !on);
      const box = row.querySelector('input[type="checkbox"]');
      if (box) box.checked = on;
    });
    return;
  }
  el.plotLegend.replaceChildren(
    ...LEGEND_ITEMS.map((item) => {
      const row = document.createElement("label");
      row.className = `plot-legend-item${state.hidden.has(item.id) ? " is-off" : ""}`;
      row.dataset.id = item.id;
      const box = document.createElement("input");
      box.type = "checkbox";
      box.checked = !state.hidden.has(item.id);
      box.addEventListener("change", () => {
        if (box.checked) state.hidden.delete(item.id);
        else state.hidden.add(item.id);
        row.classList.toggle("is-off", !box.checked);
        renderer?.draw();
      });
      const swatch = document.createElement("span");
      swatch.className = "plot-legend-swatch";
      swatch.style.background = item.color;
      const label = document.createElement("span");
      label.textContent = item.label;
      row.append(box, swatch, label);
      return row;
    }),
  );
  el.plotLegend.hidden = false;
  state.legendBuilt = true;
}

class ParametricRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.dpr = Math.max(window.devicePixelRatio || 1, 1);
    this.w = 0;
    this.h = 0;
    this.resize();
    window.addEventListener("resize", () => this.resize());
    this._wireInteractions();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.w = Math.max(320, Math.floor(rect.width));
    this.h = Math.max(220, Math.floor(rect.height));
    this.canvas.width = Math.floor(this.w * this.dpr);
    this.canvas.height = Math.floor(this.h * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.draw();
  }

  plotArea() {
    return {
      left: PLOT_PAD,
      top: PLOT_PAD,
      width: this.w - 2 * PLOT_PAD,
      height: this.h - 2 * PLOT_PAD,
      right: this.w - PLOT_PAD,
      bottom: this.h - PLOT_PAD,
    };
  }

  worldToScreen(x, y) {
    const v = state.view;
    const p = this.plotArea();
    const sx = p.left + ((x - v.xmin) / (v.xmax - v.xmin)) * p.width;
    const sy = p.top + (1 - (y - v.ymin) / (v.ymax - v.ymin)) * p.height;
    return [sx, sy];
  }

  screenToWorld(sx, sy) {
    const v = state.view;
    const p = this.plotArea();
    const x = v.xmin + ((sx - p.left) / p.width) * (v.xmax - v.xmin);
    const y = v.ymax - ((sy - p.top) / p.height) * (v.ymax - v.ymin);
    return [x, y];
  }

  drawGrid() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.w, this.h);
    const grad = ctx.createLinearGradient(0, 0, this.w, this.h);
    grad.addColorStop(0, "#1d2742");
    grad.addColorStop(1, "#131c33");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, this.w, this.h);

    const v = state.view;
    const p = this.plotArea();
    const xSpan = v.xmax - v.xmin;
    const ySpan = v.ymax - v.ymin;
    const stepX = window.GraphAxisLabels?.niceStep?.(xSpan, 10) || xSpan / 10;
    const stepY = window.GraphAxisLabels?.niceStep?.(ySpan, 8) || ySpan / 8;
    const startX = Math.ceil(v.xmin / stepX) * stepX;
    const startY = Math.ceil(v.ymin / stepY) * stepY;

    ctx.strokeStyle = "rgba(90, 109, 161, 0.35)";
    ctx.lineWidth = 1;
    let count = 0;
    for (let gx = startX; gx <= v.xmax + stepX * 0.5 && count < 48; gx += stepX) {
      const [sx] = this.worldToScreen(gx, v.ymin);
      ctx.beginPath();
      ctx.moveTo(sx, p.top);
      ctx.lineTo(sx, p.bottom);
      ctx.stroke();
      count += 1;
    }
    count = 0;
    for (let gy = startY; gy <= v.ymax + stepY * 0.5 && count < 48; gy += stepY) {
      const [, sy] = this.worldToScreen(v.xmin, gy);
      ctx.beginPath();
      ctx.moveTo(p.left, sy);
      ctx.lineTo(p.right, sy);
      ctx.stroke();
      count += 1;
    }

    const [x0] = this.worldToScreen(0, v.ymin);
    const [, y0] = this.worldToScreen(v.xmin, 0);
    ctx.strokeStyle = "rgba(188, 200, 240, 0.72)";
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(x0, p.top);
    ctx.lineTo(x0, p.bottom);
    ctx.moveTo(p.left, y0);
    ctx.lineTo(p.right, y0);
    ctx.stroke();

    window.GraphAxisLabels?.drawCartesian?.(ctx, {
      worldToScreen: (x, y) => this.worldToScreen(x, y),
      xmin: v.xmin,
      xmax: v.xmax,
      ymin: v.ymin,
      ymax: v.ymax,
      width: this.w,
      height: this.h,
      stepX,
      stepY,
      pixelScale: 1,
    });
  }

  drawCurve(endIndex = null, color = "#2ee8bb", width = 2.8, alpha = 1) {
    const ctx = this.ctx;
    const data = state.data;
    if (!data || !layerVisible("curve")) return;
    const n = endIndex == null ? data.xCurve.length : clamp(endIndex, 1, data.xCurve.length);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < n; i += 1) {
      const x = data.xCurve[i];
      const y = data.yCurve[i];
      if (x === null || y === null) {
        started = false;
        continue;
      }
      const [sx, sy] = this.worldToScreen(x, y);
      if (!started) {
        ctx.moveTo(sx, sy);
        started = true;
      } else {
        ctx.lineTo(sx, sy);
      }
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  drawParticle(index, color = "#f5c842") {
    const data = state.data;
    if (!data || !layerVisible("curve")) return;
    const i = clamp(Math.floor(index), 0, data.xCurve.length - 1);
    const x = data.xCurve[i];
    const y = data.yCurve[i];
    if (x === null || y === null) return;
    const [sx, sy] = this.worldToScreen(x, y);
    const ctx = this.ctx;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(sx, sy, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.75)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  drawVectors(fade = 1) {
    const ctx = this.ctx;
    if (!state.data?.vectors || !layerVisible("velocity")) return;
    ctx.strokeStyle = `rgba(240, 96, 144, ${0.25 + 0.75 * fade})`;
    ctx.fillStyle = `rgba(240, 96, 144, ${0.25 + 0.75 * fade})`;
    ctx.lineWidth = 2;
    for (const v of state.data.vectors) {
      const [x0, y0] = this.worldToScreen(v.x, v.y);
      const [x1, y1] = this.worldToScreen(v.x + v.dx, v.y + v.dy);
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
      const ang = Math.atan2(y1 - y0, x1 - x0);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x1 - 8 * Math.cos(ang - 0.35), y1 - 8 * Math.sin(ang - 0.35));
      ctx.lineTo(x1 - 8 * Math.cos(ang + 0.35), y1 - 8 * Math.sin(ang + 0.35));
      ctx.closePath();
      ctx.fill();
    }
  }

  drawTangents(fade = 1) {
    const ctx = this.ctx;
    if (!state.data?.tangents || !layerVisible("slope")) return;
    ctx.strokeStyle = `rgba(124, 199, 255, ${0.25 + 0.75 * fade})`;
    ctx.lineWidth = 4.2 * fade + 1.2;
    for (const seg of state.data.tangents) {
      const [x1, y1] = this.worldToScreen(seg.x1, seg.y1);
      const [x2, y2] = this.worldToScreen(seg.x2, seg.y2);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
  }

  drawSpeedMarkers(fade = 1) {
    const data = state.data;
    if (!data || !layerVisible("speed")) return;
    const ctx = this.ctx;
    const maxSpeed = Math.max(...data.speed.filter((v) => v !== null && Number.isFinite(v)), 1e-6);
    for (let i = 0; i < data.xCurve.length; i += 12) {
      const x = data.xCurve[i];
      const y = data.yCurve[i];
      const s = data.speed[i];
      if (x === null || y === null || s === null) continue;
      const tNorm = s / maxSpeed;
      const r = 2 + 6 * tNorm;
      const [sx, sy] = this.worldToScreen(x, y);
      ctx.fillStyle = `rgba(245, 200, 66, ${(0.18 + 0.72 * tNorm) * fade})`;
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  draw() {
    this.drawGrid();
    if (!state.data) {
      const ctx = this.ctx;
      ctx.fillStyle = "#94a3d9";
      ctx.font = "15px -apple-system, BlinkMacSystemFont, sans-serif";
      ctx.fillText("Enter x(t) and y(t), then press Animate.", 64, 44);
      renderLegend();
      updateReadouts();
      return;
    }

    const seg = phaseAtProgress(state.progress);
    const t = easeInOut(clamp(seg.local, 0, 1));
    const data = state.data;
    const traceIndex = Math.floor(t * (data.xCurve.length - 1));
    const showAll = !state.animating && state.progress >= 1;

    if (showAll || seg.phase === "speed") {
      this.drawCurve(null, "#2ee8bb", 2.4, showAll ? 0.85 : 0.55);
      this.drawVectors(showAll ? 0.85 : 0.2);
      this.drawTangents(showAll ? 0.85 : 0.45);
      this.drawSpeedMarkers(showAll ? 1 : t);
      if (showAll) this.drawParticle(Math.floor(0.5 * (data.xCurve.length - 1)));
      el.phaseLine.textContent = showAll
        ? "Complete: curve, velocity, slope, and speed"
        : "Phase 4: speed ‖v‖ and arc length";
      LatexDisplay.setImage(el.latexImage, data.latexPngRules?.speed || data.latexPng);
    } else if (seg.phase === "curve") {
      this.drawCurve(traceIndex, "#2ee8bb", 2.9, 1);
      this.drawParticle(traceIndex);
      el.phaseLine.textContent = "Phase 1: parametric curve (x(t), y(t))";
      LatexDisplay.setImage(el.latexImage, data.latexPngRules?.curve || data.latexPng);
    } else if (seg.phase === "velocity") {
      this.drawCurve(null, "#2ee8bb", 2.5, 0.8);
      this.drawVectors(t);
      this.drawParticle(Math.floor(0.35 * (data.xCurve.length - 1)));
      el.phaseLine.textContent = "Phase 2: velocity vectors ⟨x′(t), y′(t)⟩";
      LatexDisplay.setImage(el.latexImage, data.latexPngRules?.velocity || data.latexPng);
    } else {
      this.drawCurve(null, "#2ee8bb", 2.4, 0.62);
      this.drawVectors(0.25);
      this.drawTangents(t);
      el.phaseLine.textContent = "Phase 3: tangent slope dy/dx = y′/x′";
      LatexDisplay.setImage(el.latexImage, data.latexPngRules?.slope || data.latexPng);
    }

    renderLegend();
    updateReadouts();
  }

  _wireInteractions() {
    this.canvas.style.cursor = "grab";
    this.canvas.addEventListener("mousedown", (e) => {
      if (state.viewLocked) return;
      if (state.animating) {
        stopAnimation();
        setStatus("animation stopped. drag to pan, scroll to zoom.");
      }
      state.drag = {
        x: e.clientX,
        y: e.clientY,
        view: { ...state.view },
      };
      this.canvas.style.cursor = "grabbing";
    });
    window.addEventListener("mouseup", () => {
      state.drag = null;
      this.canvas.style.cursor = "grab";
    });
    window.addEventListener("mousemove", (e) => {
      if (!state.drag || state.viewLocked) return;
      const dx = e.clientX - state.drag.x;
      const dy = e.clientY - state.drag.y;
      const rect = this.canvas.getBoundingClientRect();
      const v = state.drag.view;
      const spanX = v.xmax - v.xmin;
      const spanY = v.ymax - v.ymin;
      state.view = {
        xmin: v.xmin - (dx / rect.width) * spanX,
        xmax: v.xmax - (dx / rect.width) * spanX,
        ymin: v.ymin + (dy / rect.height) * spanY,
        ymax: v.ymax + (dy / rect.height) * spanY,
      };
      this.draw();
    });
    this.canvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        if (state.viewLocked || !e.deltaY) return;
        const zoom = e.deltaY > 0 ? 1.08 : 0.92;
        const rect = this.canvas.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;
        const [wx, wy] = this.screenToWorld(sx, sy);
        state.view.xmin = wx + (state.view.xmin - wx) * zoom;
        state.view.xmax = wx + (state.view.xmax - wx) * zoom;
        state.view.ymin = wy + (state.view.ymin - wy) * zoom;
        state.view.ymax = wy + (state.view.ymax - wy) * zoom;
        this.draw();
      },
      { passive: false },
    );
  }
}

function updateReadouts() {
  renderer?.scaleBar?.sync();
  if (state.data?.arcLength != null && Number.isFinite(state.data.arcLength)) {
    LatexDisplay.renderReadout(el.readoutImage, {
      kind: "parametric_arc",
      length: state.data.arcLength,
    });
  } else {
    LatexDisplay.clearReadout(el.readoutImage);
  }
}

function stopAnimation() {
  state.animating = false;
  state.paused = false;
  state.lastTs = 0;
  if (state.rafId) cancelAnimationFrame(state.rafId);
  state.rafId = null;
  el.pauseBtn.textContent = "Pause";
}

function loop(ts) {
  if (!state.animating || !state.data) return;
  if (state.paused) {
    state.lastTs = ts;
    state.rafId = requestAnimationFrame(loop);
    return;
  }
  if (!state.lastTs) state.lastTs = ts;
  state.elapsed += ts - state.lastTs;
  state.lastTs = ts;

  const duration = Number(el.durationInput.value);
  const norm = clamp(state.elapsed / duration, 0, 1);
  state.progress = norm;
  const nextPhase = phaseAtProgress(state.progress).phase;
  state.phase = nextPhase;
  renderer.draw();
  setStatus(norm < 1 ? "animating..." : "animation complete.");

  if (norm >= 1) {
    stopAnimation();
    renderer.draw();
    return;
  }
  state.rafId = requestAnimationFrame(loop);
}

function payloadFromInputs() {
  return {
    xExpr: el.xExprInput.value.trim(),
    yExpr: el.yExprInput.value.trim(),
    tmin: Number(el.tminInput.value),
    tmax: Number(el.tmaxInput.value),
    samples: 1800,
  };
}

function applyDataView(data, { rememberSnap = true } = {}) {
  state.view = {
    xmin: data.xRange[0],
    xmax: data.xRange[1],
    ymin: data.yRange[0],
    ymax: data.yRange[1],
  };
  if (rememberSnap) state.snapView = { ...state.view };
}

function syncViewLockChrome() {
  renderer?.viewSnap?.sync();
  renderer?.scaleBar?.root?.classList.toggle("is-view-locked", state.viewLocked);
}

function lockParametricView() {
  if (state.snapView) {
    state.view = { ...state.snapView };
  } else if (state.data) {
    applyDataView(state.data);
  }
  state.viewLocked = true;
  syncViewLockChrome();
  renderer?.draw();
}

function unlockParametricView() {
  state.viewLocked = false;
  syncViewLockChrome();
}

async function computeModel() {
  const payload = payloadFromInputs();
  if (!payload.xExpr || !payload.yExpr) {
    setStatus("Please enter x(t) and y(t).");
    return false;
  }
  setStatus("computing parametric derivatives...");
  const result = await window.pywebview.api.compute_parametric(payload);
  if (!result.ok) {
    setStatus(`error: ${result.error}`);
    return false;
  }
  state.data = result;
  state.params = payload;
  state.progress = 0;
  state.phase = "curve";
  state.legendBuilt = false;
  applyDataView(result);
  LatexDisplay.setImage(el.latexImage, result.latexPng);
  renderer.draw();
  setStatus("ready. press Animate.");
  return true;
}

function scheduleRecompute() {
  if (state.recomputeTimer) clearTimeout(state.recomputeTimer);
  state.recomputeTimer = setTimeout(async () => {
    stopAnimation();
    await computeModel();
  }, 160);
}

function wireInteractions() {
  if (el.homeBtn) {
    el.homeBtn.addEventListener("click", async () => {
      stopAnimation();
      if (typeof window.pywebview.api.go_home === "function") {
        await VizTransition.navigateWithWoosh(VizTransition.back, () => (
          window.pywebview.api.go_home()
        ));
      }
    });
  }

  el.animateBtn.addEventListener("click", async () => {
    stopAnimation();
    const ok = await computeModel();
    if (!ok) return;
    state.animating = true;
    state.paused = false;
    state.lastTs = 0;
    state.elapsed = 0;
    state.progress = 0;
    state.phase = "curve";
    setStatus("starting animation...");
    state.rafId = requestAnimationFrame(loop);
  });

  el.pauseBtn.addEventListener("click", () => {
    if (!state.animating) {
      setStatus("nothing to pause. press Animate first.");
      return;
    }
    state.paused = !state.paused;
    el.pauseBtn.textContent = state.paused ? "Resume" : "Pause";
    setStatus(state.paused ? "paused." : "resumed.");
  });

  el.resetBtn.addEventListener("click", () => {
    stopAnimation();
    state.progress = 0;
    state.phase = "curve";
    state.hidden.clear();
    state.legendBuilt = false;
    if (state.data) applyDataView(state.data);
    renderer.draw();
    setStatus("view reset.");
  });

  el.durationInput.addEventListener("input", () => {
    el.durationValue.textContent = `${el.durationInput.value} ms`;
  });

  [el.xExprInput, el.yExprInput, el.tminInput, el.tmaxInput].forEach((input) => {
    input.addEventListener("input", scheduleRecompute);
    input.addEventListener("change", scheduleRecompute);
  });
}

async function bootstrap() {
  VizTransition.initPageTransition();
  el.homeBtn = $("homeBtn");
  el.xExprInput = $("xExprInput");
  el.yExprInput = $("yExprInput");
  el.tminInput = $("tminInput");
  el.tmaxInput = $("tmaxInput");
  el.durationInput = $("durationInput");
  el.durationValue = $("durationValue");
  el.animateBtn = $("animateBtn");
  el.pauseBtn = $("pauseBtn");
  el.resetBtn = $("resetBtn");
  el.status = $("status");
  el.phaseLine = $("phaseLine");
  el.metricLine = $("metricLine");
  el.ruleLine = $("ruleLine");
  el.latexImage = $("latexImage");
  el.readoutImage = $("readoutImage");
  el.plotLegend = $("plotLegend");

  renderer = new ParametricRenderer($("paramCanvas"));
  renderer.scaleBar = window.ScaleBar?.mount(renderer.canvas.parentElement, {
    getView: () => state.view,
    setView: (view) => {
      if (state.viewLocked) {
        state.viewLocked = false;
        syncViewLockChrome();
      }
      state.view = { ...state.view, ...view };
      renderer.draw();
    },
  });
  renderer.viewSnap = window.ViewSnapLock?.mount(renderer.canvas.parentElement, {
    isLocked: () => state.viewLocked,
    onLock: () => lockParametricView(),
    onUnlock: () => unlockParametricView(),
  });
  renderer.draw();

  const boot = await window.pywebview.api.get_parametric_bootstrap();
  const hints = $("functionHints");
  boot.hints.forEach((h) => {
    const op = document.createElement("option");
    op.value = h;
    hints.appendChild(op);
  });

  const presets = $("presets");
  boot.presets.forEach(([label, xExpr, yExpr]) => {
    const btn = document.createElement("button");
    btn.className = "preset-btn";
    btn.textContent = label;
    btn.addEventListener("click", () => {
      el.xExprInput.value = xExpr;
      el.yExprInput.value = yExpr;
      setStatus(`preset: ${label}`);
      scheduleRecompute();
    });
    presets.appendChild(btn);
  });

  wireInteractions();
  await computeModel();
}

whenApiReady(bootstrap);
