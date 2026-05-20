const PLOT_PAD = 12;

const state = {
  data: null,
  params: null,
  animating: false,
  paused: false,
  rafId: null,
  elapsed: 0,
  lastTs: 0,
  progress: 0,
  view: { xmin: -3, xmax: 3, ymin: -3, ymax: 3 },
  drag: null,
  legendVisible: true,
  recomputeTimer: null,
  visibleSectors: 0,
  animPhase: "curve",
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
  if (p < 0.22) return { phase: "curve", local: p / 0.22 };
  if (p < 0.58) return { phase: "slices", local: (p - 0.22) / 0.36 };
  return { phase: "accumulate", local: (p - 0.58) / 0.42 };
}

class PolarRenderer {
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

  polarPoint(r, th) {
    return [r * Math.cos(th), r * Math.sin(th)];
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
    const cx = 0.5 * (v.xmin + v.xmax);
    const cy = 0.5 * (v.ymin + v.ymax);
    const maxR = Math.min(v.xmax - cx, v.ymax - cy);
    const [scx, scy] = this.worldToScreen(cx, cy);

    ctx.strokeStyle = "rgba(90, 109, 161, 0.3)";
    ctx.lineWidth = 1;
    for (let k = 1; k <= 4; k += 1) {
      const r = (maxR * k) / 4;
      ctx.beginPath();
      for (let a = 0; a <= 64; a += 1) {
        const th = (a / 64) * Math.PI * 2;
        const [x, y] = this.polarPoint(r, th);
        const [sx, sy] = this.worldToScreen(x + cx, y + cy);
        if (a === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      }
      ctx.stroke();
    }
    for (let a = 0; a < 8; a += 1) {
      const th = (a / 8) * Math.PI * 2;
      const [x, y] = this.polarPoint(maxR, th);
      const [sx0, sy0] = this.worldToScreen(cx, cy);
      const [sx1, sy1] = this.worldToScreen(x + cx, y + cy);
      ctx.beginPath();
      ctx.moveTo(sx0, sy0);
      ctx.lineTo(sx1, sy1);
      ctx.stroke();
    }

    const p = this.plotArea();
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
  }

  drawCurve(xs, ys, color, width = 2.6, alpha = 1) {
    if (!xs?.length) return;
    const ctx = this.ctx;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < xs.length; i += 1) {
      const x = xs[i];
      const y = ys[i];
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

  sectorBoundaryPoints(sector, compare) {
    const steps = 10;
    const t0 = sector.theta0;
    const t1 = sector.theta1;
    const outer = [];
    const inner = [];
    for (let s = 0; s <= steps; s += 1) {
      const th = t0 + (s / steps) * (t1 - t0);
      let ro;
      let ri;
      if (compare) {
        const ro0 = sector.rOuter0;
        const ri0 = sector.rInner0;
        const ro1 = sector.rOuter1;
        const ri1 = sector.rInner1;
        const u = s / steps;
        ro = ro0 * (1 - u) + ro1 * u;
        ri = ri0 * (1 - u) + ri1 * u;
      } else {
        const ro0 = sector.rOuter0;
        const ro1 = sector.rOuter1;
        const u = s / steps;
        ro = ro0 * (1 - u) + ro1 * u;
        ri = 0;
      }
      outer.push(this.polarPoint(ro, th));
      inner.push(this.polarPoint(ri, th));
    }
    return { outer, inner };
  }

  drawSector(sector, compare, fillAlpha, strokeOnly = false) {
    const ctx = this.ctx;
    const { outer, inner } = this.sectorBoundaryPoints(sector, compare);
    ctx.beginPath();
    const [ox0, oy0] = outer[0];
    const [isx, isy] = this.worldToScreen(0, 0);
    ctx.moveTo(isx, isy);
    for (const [x, y] of outer) {
      const [sx, sy] = this.worldToScreen(x, y);
      ctx.lineTo(sx, sy);
    }
    if (compare) {
      for (let i = inner.length - 1; i >= 0; i -= 1) {
        const [x, y] = inner[i];
        const [sx, sy] = this.worldToScreen(x, y);
        ctx.lineTo(sx, sy);
      }
    } else {
      ctx.lineTo(isx, isy);
    }
    ctx.closePath();
    if (!strokeOnly) {
      ctx.fillStyle = `rgba(124, 106, 247, ${fillAlpha})`;
      ctx.fill();
    }
    ctx.strokeStyle = "rgba(245, 200, 66, 0.85)";
    ctx.lineWidth = 1.3;
    ctx.stroke();
  }

  drawIntersections() {
    const data = state.data;
    if (!data?.intersections?.length) return;
    const ctx = this.ctx;
    for (const th of data.intersections) {
      const r = data.mode === "compare" ? 0.15 : 0.12;
      const [x, y] = this.polarPoint(r * 3, th);
      const [sx, sy] = this.worldToScreen(x, y);
      ctx.fillStyle = "#f06090";
      ctx.beginPath();
      ctx.arc(sx, sy, 5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  drawLegend() {
    if (!state.legendVisible) return;
    const ctx = this.ctx;
    const x = 64;
    const y = 24;
    const w = 180;
    const h = 44;
    ctx.fillStyle = "rgba(20, 29, 50, 0.82)";
    ctx.strokeStyle = "rgba(159, 182, 255, 0.38)";
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
    ctx.font = "10px -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.fillStyle = "#2ee8bb";
    ctx.fillText("cyan = r₁(θ)", x + 8, y + 14);
    ctx.fillStyle = "#9e8dff";
    ctx.fillText("purple = r₂(θ)", x + 8, y + 26);
    ctx.fillStyle = "#7c6af7";
    ctx.fillText("shade = area slices", x + 8, y + 38);
  }

  draw() {
    this.drawGrid();
    if (!state.data) {
      const ctx = this.ctx;
      ctx.fillStyle = "#94a3d9";
      ctx.font = "15px -apple-system, BlinkMacSystemFont, sans-serif";
      ctx.fillText("Enter r(θ) and press ANIMATE.", 64, 44);
      updateReadouts();
      return;
    }

    const data = state.data;
    const seg = phaseAtProgress(state.progress);
    const t = easeInOut(clamp(seg.local, 0, 1));
    const compare = data.mode === "compare";

    if (compare) {
      this.drawCurve(data.xCurve2, data.yCurve2, "#9e8dff", 2.4, seg.phase === "curve" ? t : 0.85);
    }
    this.drawCurve(data.xCurve, data.yCurve, "#2ee8bb", 2.8, seg.phase === "curve" ? 0.4 + 0.6 * t : 1);

    const nSectors = data.sectors.length;
    let visibleCount = 0;
    if (seg.phase === "slices") {
      visibleCount = Math.max(1, Math.ceil(t * nSectors));
      el.phaseLine.textContent = `Phase 2: sector slices (${visibleCount}/${nSectors})`;
    } else if (seg.phase === "accumulate") {
      visibleCount = Math.max(1, Math.ceil(t * nSectors));
      el.phaseLine.textContent = `Phase 3: area accumulation (${visibleCount}/${nSectors})`;
    } else {
      visibleCount = 0;
      el.phaseLine.textContent = "Phase 1: polar curve(s)";
    }

    state.visibleSectors = visibleCount;
    state.animPhase = seg.phase;

    for (let i = 0; i < nSectors; i += 1) {
      const sector = data.sectors[i];
      if (seg.phase === "curve") continue;
      if ((seg.phase === "slices" || seg.phase === "accumulate") && i >= visibleCount) continue;
      const fillAlpha = seg.phase === "accumulate"
        ? 0.12 + 0.55 * ((i + 1) / nSectors)
        : 0.08;
      const strokeOnly = seg.phase === "slices" && i === visibleCount - 1;
      this.drawSector(sector, compare, fillAlpha, seg.phase === "slices");
    }

    if (compare && data.intersections?.length) {
      this.drawIntersections();
    }
    this.drawLegend();
    updateReadouts(visibleCount, seg.phase);
  }

  _wireInteractions() {
    this.canvas.style.cursor = "grab";
    this.canvas.addEventListener("mousedown", (e) => {
      if (state.animating) {
        stopAnimation();
        setStatus("animation stopped. drag to pan, scroll to zoom.");
      }
      state.drag = { x: e.clientX, y: e.clientY, view: { ...state.view } };
      this.canvas.style.cursor = "grabbing";
    });
    window.addEventListener("mouseup", () => {
      state.drag = null;
      this.canvas.style.cursor = "grab";
    });
    window.addEventListener("mousemove", (e) => {
      if (!state.drag) return;
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
        const zoom = e.deltaY > 0 ? 1.08 : 0.92;
        const rect = this.canvas.getBoundingClientRect();
        const [wx, wy] = this.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
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

function sectorEstimate(data, count) {
  if (!data?.sectors?.length || count <= 0) return 0;
  const idx = Math.min(count, data.sectors.length) - 1;
  return data.sectors[idx].cumulative;
}

function formatErrorLabel(exact, estimate) {
  if (!Number.isFinite(exact) || !Number.isFinite(estimate)) return "error —";
  const absErr = Math.abs(estimate - exact);
  if (absErr < 5e-7) return "error 0%";
  const pct = Math.abs(exact) > 1e-12 ? (absErr / Math.abs(exact)) * 100 : absErr * 100;
  const pctText = pct >= 0.01 ? pct.toFixed(2) : pct.toFixed(4);
  return `error ${pctText}% (Δ=${absErr.toFixed(6)})`;
}

function updateReadouts(visibleCount = null, phase = null) {
  const v = state.view;
  el.scaleLine.textContent =
    `Scale: x [${v.xmin.toFixed(2)}, ${v.xmax.toFixed(2)}], y [${v.ymin.toFixed(2)}, ${v.ymax.toFixed(2)}]`;
  if (!state.data) return;

  const data = state.data;
  const n = data.nSectors;
  const exact = data.totalArea;
  const k = visibleCount == null
    ? (state.animating ? state.visibleSectors : n)
    : visibleCount;
  const estimate = sectorEstimate(data, k);
  const errLabel = formatErrorLabel(exact, estimate);

  if (phase === "curve" || (state.animating && k <= 0)) {
    el.areaLine.textContent =
      `Exact area ≈ ${exact.toFixed(6)}  |  Sector estimate: 0.000000 (0/${n})`;
  } else if (state.animating && k < n) {
    el.areaLine.textContent =
      `Exact ≈ ${exact.toFixed(6)}  |  Estimate (${k}/${n} slices): ${estimate.toFixed(6)}  |  ${errLabel}`;
  } else {
    el.areaLine.textContent =
      `Exact ≈ ${exact.toFixed(6)}  |  Estimate (n=${n}): ${estimate.toFixed(6)}  |  ${errLabel}`;
  }

  if (data.intersections?.length) {
    el.intersectionLine.textContent =
      `Intersections at θ: ${data.intersections.map((a) => a.toFixed(3)).join(", ")}`;
  } else {
    el.intersectionLine.textContent = "";
  }
}

function stopAnimation() {
  state.animating = false;
  state.paused = false;
  state.lastTs = 0;
  if (state.rafId) cancelAnimationFrame(state.rafId);
  state.rafId = null;
  el.pauseBtn.textContent = "⏸ PAUSE";
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
  state.progress = clamp(state.elapsed / Number(el.durationInput.value), 0, 1);
  renderer.draw();
  setStatus(state.progress < 1 ? "animating polar area..." : "animation complete.");
  if (state.progress >= 1) {
    stopAnimation();
    return;
  }
  state.rafId = requestAnimationFrame(loop);
}

function payloadFromInputs() {
  return {
    mode: el.modeInput.value,
    rExpr: el.rExprInput.value.trim(),
    r2Expr: el.r2ExprInput.value.trim(),
    alpha: el.alphaInput.value.trim(),
    beta: el.betaInput.value.trim(),
    nSectors: Number(el.nInput.value),
    samples: 1800,
  };
}

function applyDataView(data) {
  state.view = {
    xmin: data.xRange[0],
    xmax: data.xRange[1],
    ymin: data.yRange[0],
    ymax: data.yRange[1],
  };
}

function updateModeUi() {
  const compare = el.modeInput.value === "compare";
  el.r2Label.style.display = compare ? "block" : "none";
  el.r2ExprInput.style.display = compare ? "block" : "none";
}

async function computeModel() {
  const payload = payloadFromInputs();
  if (!payload.rExpr) {
    setStatus("Please enter r(θ).");
    return false;
  }
  setStatus("computing polar area...");
  const result = await window.pywebview.api.compute_polar(payload);
  if (!result.ok) {
    setStatus(`error: ${result.error}`);
    return false;
  }
  state.data = result;
  state.params = payload;
  state.progress = 0;
  applyDataView(result);
  el.ruleLine.textContent = result.areaFormula;
  renderer.draw();
  setStatus("ready. press ANIMATE.");
  return true;
}

function scheduleRecompute() {
  if (state.recomputeTimer) clearTimeout(state.recomputeTimer);
  state.recomputeTimer = setTimeout(async () => {
    stopAnimation();
    await computeModel();
  }, 350);
}

function wireInteractions() {
  if (el.homeBtn) {
    el.homeBtn.addEventListener("click", async () => {
      stopAnimation();
      if (typeof window.pywebview.api.go_home === "function") {
        await VizTransition.navigateWithWoosh(VizTransition.back, () => {
          window.pywebview.api.go_home();
        });
      }
    });
  }

  el.modeInput.addEventListener("change", () => {
    updateModeUi();
    scheduleRecompute();
  });

  el.animateBtn.addEventListener("click", async () => {
    stopAnimation();
    const ok = await computeModel();
    if (!ok) return;
    state.animating = true;
    state.paused = false;
    state.lastTs = 0;
    state.elapsed = 0;
    state.progress = 0;
    setStatus("starting animation...");
    state.rafId = requestAnimationFrame(loop);
  });

  el.legendToggleBtn.addEventListener("click", () => {
    state.legendVisible = !state.legendVisible;
    el.legendToggleBtn.textContent = state.legendVisible ? "Hide legend" : "Show legend";
    renderer.draw();
  });

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
    state.progress = 0;
    if (state.data) applyDataView(state.data);
    renderer.draw();
    setStatus("view reset.");
  });

  el.nInput.addEventListener("input", () => {
    el.nValue.textContent = el.nInput.value;
    scheduleRecompute();
  });

  el.durationInput.addEventListener("input", () => {
    el.durationValue.textContent = `${el.durationInput.value} ms`;
  });

  [
    el.rExprInput,
    el.r2ExprInput,
    el.alphaInput,
    el.betaInput,
  ].forEach((input) => {
    input.addEventListener("input", scheduleRecompute);
    input.addEventListener("change", scheduleRecompute);
  });
}

async function bootstrap() {
  VizTransition.initPageTransition();
  el.homeBtn = $("homeBtn");
  el.modeInput = $("modeInput");
  el.rExprInput = $("rExprInput");
  el.r2ExprInput = $("r2ExprInput");
  el.r2Label = $("r2Label");
  el.alphaInput = $("alphaInput");
  el.betaInput = $("betaInput");
  el.nInput = $("nInput");
  el.nValue = $("nValue");
  el.durationInput = $("durationInput");
  el.durationValue = $("durationValue");
  el.animateBtn = $("animateBtn");
  el.pauseBtn = $("pauseBtn");
  el.resetBtn = $("resetBtn");
  el.legendToggleBtn = $("legendToggleBtn");
  el.status = $("status");
  el.phaseLine = $("phaseLine");
  el.scaleLine = $("scaleLine");
  el.intersectionLine = $("intersectionLine");
  el.ruleLine = $("ruleLine");
  el.areaLine = $("areaLine");

  renderer = new PolarRenderer($("polarCanvas"));
  renderer.draw();

  const boot = await window.pywebview.api.get_polar_bootstrap();
  boot.modes.forEach(([id, label]) => {
    const op = document.createElement("option");
    op.value = id;
    op.textContent = label;
    el.modeInput.appendChild(op);
  });

  const presets = $("presets");
  boot.presets.forEach(([label, r1, r2, alpha, beta]) => {
    const btn = document.createElement("button");
    btn.className = "preset-btn";
    btn.textContent = label;
    btn.addEventListener("click", () => {
      el.rExprInput.value = r1;
      if (r2) {
        el.modeInput.value = "compare";
        el.r2ExprInput.value = r2;
      } else {
        el.modeInput.value = "single";
      }
      el.alphaInput.value = String(alpha);
      el.betaInput.value = String(beta);
      updateModeUi();
      setStatus(`preset: ${label}`);
      scheduleRecompute();
    });
    presets.appendChild(btn);
  });

  updateModeUi();
  wireInteractions();
  await computeModel();
}

whenApiReady(bootstrap);
