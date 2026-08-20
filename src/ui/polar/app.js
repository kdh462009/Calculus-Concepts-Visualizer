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
    this.lockAspect();
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

  /** Keep equal world units per pixel so polar rings stay circular. */
  lockAspect(anchorX = null, anchorY = null) {
    const v = state.view;
    const p = this.plotArea();
    if (!(p.width > 0 && p.height > 0)) return;
    const screenAspect = p.width / p.height;
    let spanX = v.xmax - v.xmin;
    let spanY = v.ymax - v.ymin;
    if (!(spanX > 0 && spanY > 0)) return;

    const ax = Number.isFinite(anchorX) ? anchorX : 0.5 * (v.xmin + v.xmax);
    const ay = Number.isFinite(anchorY) ? anchorY : 0.5 * (v.ymin + v.ymax);
    const worldAspect = spanX / spanY;

    if (worldAspect > screenAspect) {
      spanY = spanX / screenAspect;
    } else {
      spanX = spanY * screenAspect;
    }

    const fx = (ax - v.xmin) / (v.xmax - v.xmin);
    const fy = (ay - v.ymin) / (v.ymax - v.ymin);
    state.view = {
      xmin: ax - fx * spanX,
      xmax: ax + (1 - fx) * spanX,
      ymin: ay - fy * spanY,
      ymax: ay + (1 - fy) * spanY,
    };
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
    // Rings and rays are always anchored at the polar origin (0, 0),
    // not the viewport center — otherwise pan makes the grid drift off the curve.
    const maxR = Math.max(
      Math.hypot(v.xmin, v.ymin),
      Math.hypot(v.xmin, v.ymax),
      Math.hypot(v.xmax, v.ymin),
      Math.hypot(v.xmax, v.ymax),
      1e-6,
    );
    // Prefer rings that cross the visible axes so radius numbers can land on-screen.
    const axisReach = Math.max(
      Math.abs(v.xmin),
      Math.abs(v.xmax),
      Math.abs(v.ymin),
      Math.abs(v.ymax),
      1e-6,
    );
    const step = window.GraphAxisLabels?.niceStep?.(axisReach, 4) || axisReach / 4;
    const radii = [];
    for (let r = step; r <= maxR * 1.001; r += step) {
      radii.push(r);
    }
    if (!radii.length) radii.push(Math.min(step, maxR));

    ctx.strokeStyle = "rgba(90, 109, 161, 0.3)";
    ctx.lineWidth = 1;
    for (const r of radii) {
      ctx.beginPath();
      for (let a = 0; a <= 96; a += 1) {
        const th = (a / 96) * Math.PI * 2;
        const [x, y] = this.polarPoint(r, th);
        const [sx, sy] = this.worldToScreen(x, y);
        if (a === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      }
      ctx.closePath();
      ctx.stroke();
    }
    for (let a = 0; a < 12; a += 1) {
      const th = (a / 12) * Math.PI * 2;
      const [x, y] = this.polarPoint(maxR, th);
      const [sx0, sy0] = this.worldToScreen(0, 0);
      const [sx1, sy1] = this.worldToScreen(x, y);
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

    const labelRadii = radii.filter((r) => r <= axisReach * 1.02);
    window.GraphAxisLabels?.drawPolarRadii?.(ctx, {
      worldToScreen: (x, y) => this.worldToScreen(x, y),
      cx: 0,
      cy: 0,
      radii: labelRadii.length ? labelRadii : radii.slice(0, 4),
      width: this.w,
      height: this.h,
      pixelScale: 1,
    });
    window.GraphAxisLabels?.drawPolarAngles?.(ctx, {
      worldToScreen: (x, y) => this.worldToScreen(x, y),
      cx: 0,
      cy: 0,
      radius: Math.min(axisReach * 0.95, maxR * 0.85),
      width: this.w,
      height: this.h,
      pixelScale: 1,
    });
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
    const steps = 16;
    const t0 = sector.theta0;
    const t1 = sector.theta1;
    const outer = [];
    const inner = [];
    for (let s = 0; s <= steps; s += 1) {
      const th = t0 + (s / steps) * (t1 - t0);
      const u = s / steps;
      if (compare && sector.r1_0 != null) {
        const r1 = sector.r1_0 * (1 - u) + sector.r1_1 * u;
        const r2 = sector.r2_0 * (1 - u) + sector.r2_1 * u;
        let rout;
        let rin;
        if (Math.abs(r1) >= Math.abs(r2)) {
          rout = r1;
          rin = r2;
        } else {
          rout = r2;
          rin = r1;
        }
        outer.push(this.polarPoint(rout, th));
        inner.push(this.polarPoint(rin, th));
      } else {
        const r = sector.rOuter0 * (1 - u) + sector.rOuter1 * u;
        outer.push(this.polarPoint(r, th));
        inner.push([0, 0]);
      }
    }
    return { outer, inner };
  }

  drawSector(sector, compare, fillAlpha, strokeOnly = false) {
    const ctx = this.ctx;
    const { outer, inner } = this.sectorBoundaryPoints(sector, compare);
    ctx.beginPath();
    if (compare) {
      const [x0, y0] = outer[0];
      const [sx0, sy0] = this.worldToScreen(x0, y0);
      ctx.moveTo(sx0, sy0);
      for (let i = 1; i < outer.length; i += 1) {
        const [sx, sy] = this.worldToScreen(outer[i][0], outer[i][1]);
        ctx.lineTo(sx, sy);
      }
      for (let i = inner.length - 1; i >= 0; i -= 1) {
        const [sx, sy] = this.worldToScreen(inner[i][0], inner[i][1]);
        ctx.lineTo(sx, sy);
      }
    } else {
      const [isx, isy] = this.worldToScreen(0, 0);
      ctx.moveTo(isx, isy);
      for (const [x, y] of outer) {
        const [sx, sy] = this.worldToScreen(x, y);
        ctx.lineTo(sx, sy);
      }
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
      const r1 = interpSeries(data.theta, data.r, th);
      const r2 = data.mode === "compare" ? interpSeries(data.theta, data.r2, th) : r1;
      const r = Number.isFinite(r1) ? r1 : r2;
      const [x, y] = this.polarPoint(r, th);
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
      ctx.fillText("Enter r(θ) and press Animate.", 64, 44);
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
      this.drawSector(sector, compare, fillAlpha, strokeOnly);
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
      this.lockAspect();
      this.draw();
    });
    this.canvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        if (!e.deltaY) return;
        const zoom = e.deltaY > 0 ? 1.08 : 0.92;
        const rect = this.canvas.getBoundingClientRect();
        const [wx, wy] = this.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
        state.view.xmin = wx + (state.view.xmin - wx) * zoom;
        state.view.xmax = wx + (state.view.xmax - wx) * zoom;
        state.view.ymin = wy + (state.view.ymin - wy) * zoom;
        state.view.ymax = wy + (state.view.ymax - wy) * zoom;
        this.lockAspect(wx, wy);
        this.draw();
      },
      { passive: false },
    );
  }
}

function interpSeries(xs, ys, x) {
  if (!xs?.length || !ys?.length) return 0;
  if (x <= xs[0]) return ys[0] ?? 0;
  const last = xs.length - 1;
  if (x >= xs[last]) return ys[last] ?? 0;
  let lo = 0;
  let hi = last;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] === x) return ys[mid] ?? 0;
    if (xs[mid] < x) lo = mid + 1;
    else hi = mid - 1;
  }
  const i = Math.max(1, lo);
  const x0 = xs[i - 1];
  const x1 = xs[i];
  const y0 = ys[i - 1];
  const y1 = ys[i];
  if (y0 == null || y1 == null || x1 === x0) return y0 ?? y1 ?? 0;
  const t = (x - x0) / (x1 - x0);
  return y0 * (1 - t) + y1 * t;
}

function sectorEstimate(data, count) {
  if (!data?.sectors?.length || count <= 0) return 0;
  const idx = Math.min(count, data.sectors.length) - 1;
  return data.sectors[idx].cumulative;
}

function updateReadouts(visibleCount = null, phase = null) {
  renderer?.scaleBar?.sync();
  if (!state.data) return;

  const data = state.data;
  const n = data.nSectors;
  const exact = data.totalArea;
  const k = visibleCount == null
    ? (state.animating ? state.visibleSectors : n)
    : visibleCount;
  const estimate = sectorEstimate(data, k);

  if (phase === "curve" || (state.animating && k <= 0)) {
    LatexDisplay.renderReadout(el.readoutImage, {
      kind: "polar",
      exact,
      estimate: 0,
      n,
      k: 0,
      phase: "curve",
    });
  } else if (state.animating && k < n) {
    LatexDisplay.renderReadout(el.readoutImage, {
      kind: "polar",
      exact,
      estimate,
      n,
      k,
      phase: "slices",
    });
  } else {
    LatexDisplay.renderReadout(el.readoutImage, {
      kind: "polar",
      exact,
      estimate,
      n,
      k: n,
      phase: "full",
    });
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
  renderer?.lockAspect?.(0, 0);
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
  el.intersectionLine = $("intersectionLine");
  el.ruleLine = $("ruleLine");
  el.latexImage = $("latexImage");
  el.readoutImage = $("readoutImage");
  el.areaLine = $("areaLine");

  renderer = new PolarRenderer($("polarCanvas"));
  renderer.scaleBar = window.ScaleBar?.mount(renderer.canvas.parentElement, {
    getView: () => state.view,
    setView: (view) => {
      state.view = { ...state.view, ...view };
      renderer.lockAspect();
      renderer.draw();
    },
  });
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
