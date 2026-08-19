const PLOT_PAD = 12;

const state = {
  data: null,
  animating: false,
  paused: false,
  rafId: null,
  elapsed: 0,
  lastTs: 0,
  idx: 0,
  view: null,
  drag: null,
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

class LimitRenderer {
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

  currentView(data) {
    if (state.view) return state.view;
    if (!data) return { xmin: -2, xmax: 2, ymin: -6, ymax: 6 };
    const [ymin, ymax] = this.computeYRange(data);
    return {
      xmin: data.xRange[0],
      xmax: data.xRange[1],
      ymin,
      ymax,
    };
  }

  fitView(data) {
    if (!data) {
      state.view = null;
      return;
    }
    const [ymin, ymax] = this.computeYRange(data);
    state.view = {
      xmin: data.xRange[0],
      xmax: data.xRange[1],
      ymin,
      ymax,
    };
  }

  screenToWorld(sx, sy, view) {
    const p = this.plotArea();
    const v = view;
    const x = v.xmin + ((sx - p.left) / p.width) * (v.xmax - v.xmin);
    const y = v.ymax - ((sy - p.top) / p.height) * (v.ymax - v.ymin);
    return [x, y];
  }

  _wireInteractions() {
    this.canvas.style.cursor = "grab";
    this.canvas.addEventListener("mousedown", (e) => {
      if (!state.view && !state.data) return;
      if (state.animating) stopAnimation();
      const view = this.currentView(state.data);
      state.drag = { x: e.clientX, y: e.clientY, view: { ...view } };
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
      this.draw(state.data, state.idx);
    });
    this.canvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        if (!e.deltaY) return;
        const view = this.currentView(state.data);
        const zoom = e.deltaY > 0 ? 1.1 : 0.9;
        const rect = this.canvas.getBoundingClientRect();
        const [wx, wy] = this.screenToWorld(e.clientX - rect.left, e.clientY - rect.top, view);
        state.view = {
          xmin: wx + (view.xmin - wx) * zoom,
          xmax: wx + (view.xmax - wx) * zoom,
          ymin: wy + (view.ymin - wy) * zoom,
          ymax: wy + (view.ymax - wy) * zoom,
        };
        this.draw(state.data, state.idx);
      },
      { passive: false },
    );
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.w = Math.max(320, Math.floor(rect.width));
    this.h = Math.max(220, Math.floor(rect.height));
    this.canvas.width = Math.floor(this.w * this.dpr);
    this.canvas.height = Math.floor(this.h * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.draw(state.data, state.idx);
  }

  computeYRange(data) {
    const vals = [];
    for (let i = 0; i < data.yTrue.length; i += 1) {
      const y = data.yTrue[i];
      if (y !== null && Number.isFinite(y)) vals.push(y);
    }
    vals.push(data.limitValue);
    if (!vals.length) return [-5, 5];
    let ymin = Math.min(...vals);
    let ymax = Math.max(...vals);
    if (ymax - ymin < 1e-6) {
      ymin -= 1;
      ymax += 1;
    }
    const pad = 0.12 * (ymax - ymin);
    return [ymin - pad, ymax + pad];
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

  mapX(x, xmin, xmax) {
    const p = this.plotArea();
    return p.left + ((x - xmin) / (xmax - xmin)) * p.width;
  }

  mapY(y, ymin, ymax) {
    const p = this.plotArea();
    return p.top + (1 - (y - ymin) / (ymax - ymin)) * p.height;
  }

  drawGrid(xmin, xmax, ymin, ymax) {
    const ctx = this.ctx;
    const p = this.plotArea();
    ctx.strokeStyle = "rgba(142, 164, 230, 0.18)";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 8; i += 1) {
      const x = p.left + (i / 8) * p.width;
      ctx.beginPath();
      ctx.moveTo(x, p.top);
      ctx.lineTo(x, p.bottom);
      ctx.stroke();
    }
    for (let j = 0; j <= 8; j += 1) {
      const y = p.top + (j / 8) * p.height;
      ctx.beginPath();
      ctx.moveTo(p.left, y);
      ctx.lineTo(p.right, y);
      ctx.stroke();
    }

    const x0 = this.mapX(0, xmin, xmax);
    const y0 = this.mapY(0, ymin, ymax);
    ctx.strokeStyle = "rgba(142, 164, 230, 0.52)";
    ctx.beginPath();
    ctx.moveTo(x0, p.top);
    ctx.lineTo(x0, p.bottom);
    ctx.moveTo(p.left, y0);
    ctx.lineTo(p.right, y0);
    ctx.stroke();
  }

  drawFunction(data, xmin, xmax, ymin, ymax) {
    const ctx = this.ctx;
    ctx.strokeStyle = "#2ee8bb";
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < data.x.length; i += 1) {
      const x = data.x[i];
      const y = data.yTrue[i];
      if (y === null || !Number.isFinite(x) || !Number.isFinite(y)) {
        started = false;
        continue;
      }
      if (started && i > 0) {
        const prev = data.yTrue[i - 1];
        if (
          prev !== null &&
          Number.isFinite(prev) &&
          prev * y < 0 &&
          Math.abs(y - prev) > 12 &&
          Math.abs(prev) > 6 &&
          Math.abs(y) > 6
        ) {
          started = false;
        }
      }
      const px = this.mapX(x, xmin, xmax);
      const py = this.mapY(y, ymin, ymax);
      if (!started) {
        ctx.moveTo(px, py);
        started = true;
      } else {
        ctx.lineTo(px, py);
      }
    }
    ctx.stroke();
  }

  drawBandAndDelta(data, eps, delta, xmin, xmax, ymin, ymax) {
    const ctx = this.ctx;
    const L = data.limitValue;
    const a = data.a;
    const yTop = this.mapY(L + eps, ymin, ymax);
    const yBot = this.mapY(L - eps, ymin, ymax);
    const xLeft = this.mapX(a - delta, xmin, xmax);
    const xRight = this.mapX(a + delta, xmin, xmax);

    const p = this.plotArea();
    ctx.fillStyle = "rgba(245, 200, 66, 0.17)";
    ctx.fillRect(p.left, yTop, p.width, yBot - yTop);
    ctx.strokeStyle = "rgba(245, 200, 66, 0.95)";
    ctx.lineWidth = 1.3;
    ctx.setLineDash([7, 5]);
    ctx.beginPath();
    ctx.moveTo(p.left, yTop);
    ctx.lineTo(p.right, yTop);
    ctx.moveTo(p.left, yBot);
    ctx.lineTo(p.right, yBot);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = "rgba(124, 106, 247, 0.14)";
    const xA = this.mapX(a, xmin, xmax);
    ctx.fillRect(xLeft, p.top, xRight - xLeft, p.height);
    ctx.strokeStyle = "rgba(124, 106, 247, 0.95)";
    ctx.setLineDash([7, 5]);
    ctx.beginPath();
    ctx.moveTo(xLeft, p.top);
    ctx.lineTo(xLeft, p.bottom);
    ctx.moveTo(xRight, p.top);
    ctx.lineTo(xRight, p.bottom);
    ctx.moveTo(xA, p.top);
    ctx.lineTo(xA, p.bottom);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = "#f5c842";
    ctx.font = "13px -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.fillText(`L + ε`, this.w - 66, yTop - 6);
    ctx.fillText(`L - ε`, this.w - 66, yBot - 6);
    ctx.fillStyle = "#9e8dff";
    ctx.fillText(`a - δ`, xLeft + 3, 28);
    ctx.fillText(`a + δ`, xRight + 3, 28);
    ctx.fillStyle = "#7df0cd";
    ctx.fillText(`a`, xA + 4, this.h - 8);
  }

  drawDotsInDelta(data, eps, delta, xmin, xmax, ymin, ymax) {
    const ctx = this.ctx;
    const a = data.a;
    const L = data.limitValue;
    const left = a - delta;
    const right = a + delta;
    for (let i = 0; i < data.x.length; i += 1) {
      const x = data.x[i];
      const y = data.yTrue[i];
      if (y === null || !Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (x <= left || x >= right || Math.abs(x - a) < 1e-9) continue;
      const inside = Math.abs(y - L) < eps;
      const px = this.mapX(x, xmin, xmax);
      const py = this.mapY(y, ymin, ymax);
      ctx.fillStyle = inside ? "rgba(125, 240, 205, 0.85)" : "rgba(240, 96, 144, 0.75)";
      ctx.beginPath();
      ctx.arc(px, py, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  draw(data, idx) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.w, this.h);
    ctx.fillStyle = "rgba(10, 16, 32, 0.96)";
    ctx.fillRect(0, 0, this.w, this.h);

    if (!data) {
      ctx.fillStyle = "#94a3d9";
      ctx.font = "15px -apple-system, BlinkMacSystemFont, sans-serif";
      ctx.fillText("Compute a limit first.", 20, 34);
      this.scaleBar?.sync();
      return;
    }

    const v = this.currentView(data);
    const xmin = v.xmin;
    const xmax = v.xmax;
    const ymin = v.ymin;
    const ymax = v.ymax;
    const i = clamp(idx, 0, data.epsPath.length - 1);
    const eps = data.epsPath[i];
    const delta = data.deltaPath[i];

    this.drawGrid(xmin, xmax, ymin, ymax);
    this.drawBandAndDelta(data, eps, delta, xmin, xmax, ymin, ymax);
    this.drawFunction(data, xmin, xmax, ymin, ymax);
    this.drawDotsInDelta(data, eps, delta, xmin, xmax, ymin, ymax);
    this.scaleBar?.sync();
  }
}

function drawCurrentFrame() {
  renderer.draw(state.data, state.idx);
}

function stopAnimation() {
  state.animating = false;
  state.paused = false;
  state.lastTs = 0;
  if (state.rafId) cancelAnimationFrame(state.rafId);
  state.rafId = null;
  el.pauseBtn.textContent = "Pause";
}

function updateReadout() {
  if (!state.data) return;
  const i = clamp(state.idx, 0, state.data.epsPath.length - 1);
  const eps = state.data.epsPath[i];
  const delta = state.data.deltaPath[i];
  el.bandLine.textContent = `Band: ${state.data.limitValue.toFixed(6)} ± ${eps.toFixed(6)}  |  Neighborhood: a ± ${delta.toFixed(6)}`;
  el.readout.textContent = `ε = ${eps.toFixed(6)}   δ = ${delta.toFixed(6)}`;
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
  state.elapsed += dt;

  const totalMs = Number(el.durationInput.value);
  const n = state.data.epsPath.length;
  const p = clamp(state.elapsed / totalMs, 0, 1);
  state.idx = Math.round(p * (n - 1));

  drawCurrentFrame();
  updateReadout();
  setStatus(p < 1 ? "tightening epsilon band and delta neighborhood..." : "animation complete.");

  if (p < 1) {
    state.rafId = requestAnimationFrame(loop);
  } else {
    stopAnimation();
  }
}

function payloadFromInputs() {
  const limitRaw = el.limitInput.value.trim();
  return {
    expr: el.exprInput.value.trim(),
    a: Number(el.aInput.value),
    xmin: Number(el.xminInput.value),
    xmax: Number(el.xmaxInput.value),
    epsStart: Number(el.epsStartInput.value),
    epsEnd: Number(el.epsEndInput.value),
    limitValue: limitRaw === "" ? null : Number(limitRaw),
    samples: 2200,
  };
}

async function computeModel() {
  const payload = payloadFromInputs();
  if (!payload.expr) {
    setStatus("Please enter a function.");
    return false;
  }
  setStatus("computing limit structure...");
  const res = await window.pywebview.api.compute_limit(payload);
  if (!res.ok) {
    setStatus(`error: ${res.error}`);
    return false;
  }
  state.data = res;
  state.elapsed = 0;
  state.idx = 0;
  renderer.fitView(res);
  drawCurrentFrame();
  updateReadout();
  if (res.estimatedLimit !== null && (el.limitInput.value || "").trim() === "") {
    el.limitInput.value = String(res.estimatedLimit);
  }
  el.definitionLine.textContent = res.definitionText;
  setStatus("computed. press Animate.");
  return true;
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

  el.computeBtn.addEventListener("click", async () => {
    stopAnimation();
    await computeModel();
  });

  el.animateBtn.addEventListener("click", async () => {
    stopAnimation();
    const ok = state.data ? true : await computeModel();
    if (!ok) return;
    state.animating = true;
    state.paused = false;
    state.lastTs = 0;
    state.elapsed = 0;
    state.idx = 0;
    setStatus("starting epsilon-delta tightening...");
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
    state.idx = 0;
    state.elapsed = 0;
    drawCurrentFrame();
    updateReadout();
    setStatus("reset.");
  });

  el.durationInput.addEventListener("input", () => {
    el.durationValue.textContent = `${el.durationInput.value} ms`;
  });
}

async function bootstrap() {
  VizTransition.initPageTransition();
  el.homeBtn = $("homeBtn");
  el.exprInput = $("exprInput");
  el.aInput = $("aInput");
  el.limitInput = $("limitInput");
  el.epsStartInput = $("epsStartInput");
  el.epsEndInput = $("epsEndInput");
  el.xminInput = $("xminInput");
  el.xmaxInput = $("xmaxInput");
  el.durationInput = $("durationInput");
  el.durationValue = $("durationValue");
  el.computeBtn = $("computeBtn");
  el.animateBtn = $("animateBtn");
  el.pauseBtn = $("pauseBtn");
  el.resetBtn = $("resetBtn");
  el.status = $("status");
  el.readout = $("readout");
  el.bandLine = $("bandLine");
  el.definitionLine = $("definitionLine");

  renderer = new LimitRenderer($("limitCanvas"));
  renderer.scaleBar = window.ScaleBar?.mount(renderer.canvas.parentElement, {
    getView: () => renderer.currentView(state.data),
    setView: (view) => {
      state.view = { ...view };
      renderer.draw(state.data, state.idx);
    },
  });
  drawCurrentFrame();

  const boot = await window.pywebview.api.get_limit_bootstrap();
  const hints = $("functionHints");
  boot.hints.forEach((h) => {
    const op = document.createElement("option");
    op.value = h;
    hints.appendChild(op);
  });

  const presets = $("presets");
  boot.presets.forEach(([label, expr, a]) => {
    const btn = document.createElement("button");
    btn.className = "preset-btn";
    btn.textContent = label;
    btn.addEventListener("click", () => {
      el.exprInput.value = expr;
      el.aInput.value = String(a);
      setStatus(`preset: ${expr}, a=${a}`);
    });
    presets.appendChild(btn);
  });

  wireInteractions();
  await computeModel();
}

whenApiReady(bootstrap);
