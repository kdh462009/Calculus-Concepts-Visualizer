const METHOD_META = {
  euler: { color: "#f5c842", width: 2.55, label: "Euler" },
  midpoint: { color: "#f06090", width: 2.35, label: "Midpoint" },
  rk4: { color: "#2ee8bb", width: 2.7, label: "RK4" },
};

const state = {
  data: null,
  params: null,
  x0: 0,
  y0: 1,
  animating: false,
  paused: false,
  rafId: null,
  elapsed: 0,
  lastTs: 0,
  stepIndex: 0,
  maxSteps: 0,
  draggingIC: false,
  clickStart: null,
  fieldTimer: null,
  ivpTimer: null,
  lastViewKey: "",
  inFlight: false,
  queued: false,
  queuedSolutionsOnly: false,
  computeGen: 0,
};

const el = {};
let viewer;

function $(id) {
  return document.getElementById(id);
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function formatNum(v, digits = 3) {
  if (!Number.isFinite(v)) return "—";
  const n = Number(v);
  const abs = Math.abs(n);
  if (abs !== 0 && (abs >= 1e4 || abs < 1e-3)) return n.toExponential(2);
  return n.toFixed(digits);
}

function setStatus(text) {
  el.status.textContent = text;
}

function setCounter(text) {
  el.termCounter.textContent = text;
}

function stepH() {
  return Number(el.hInput.value) / 100;
}

function selectedMethods() {
  const out = [];
  if (el.showEuler.checked) out.push("euler");
  if (el.showMidpoint.checked) out.push("midpoint");
  if (el.showRk4.checked) out.push("rk4");
  return out.length ? out : ["euler"];
}

function currentPayload(extra = {}) {
  const v = viewer?.view || { xmin: -4, xmax: 4, ymin: -4, ymax: 4 };
  return {
    expr: el.exprInput.value.trim(),
    xmin: v.xmin,
    xmax: v.xmax,
    ymin: v.ymin,
    ymax: v.ymax,
    x0: state.x0,
    y0: state.y0,
    h: stepH(),
    gridN: Number(el.gridInput.value),
    methods: selectedMethods(),
    integrate: true,
    ...extra,
  };
}

function stopAnimation() {
  state.animating = false;
  state.paused = false;
  if (state.rafId) cancelAnimationFrame(state.rafId);
  state.rafId = null;
  el.pauseBtn.textContent = "Pause";
}

function eventToWorld(event) {
  const rect = viewer.canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const sx = (event.clientX - rect.left) * dpr;
  const sy = (event.clientY - rect.top) * dpr;
  return viewer.screenToWorld(sx, sy);
}

function icHit(event) {
  const [sx, sy] = viewer.worldToScreen(state.x0, state.y0);
  const rect = viewer.canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const ex = (event.clientX - rect.left) * dpr;
  const ey = (event.clientY - rect.top) * dpr;
  const r = 14 * dpr;
  return Math.hypot(ex - sx, ey - sy) <= r;
}

function syncIcInputs() {
  el.x0Input.value = String(Number(state.x0.toFixed(4)));
  el.y0Input.value = String(Number(state.y0.toFixed(4)));
}

function setIc(x0, y0, { recompute = true } = {}) {
  const v = viewer.view;
  state.x0 = clamp(x0, v.xmin, v.xmax);
  state.y0 = clamp(y0, v.ymin, v.ymax);
  syncIcInputs();
  updateHeader();
  drawScene();
  if (recompute) {
    scheduleCompute({ debounceMs: state.draggingIC ? 16 : 0, solutionsOnly: state.draggingIC });
  }
}

function updateHeader() {
  const expr = state.data?.expr || el.exprInput.value.trim() || "f(x, y)";
  const slope = state.data?.slopeAtIC;
  el.exprLine.textContent = `y′ = ${expr}    y(${formatNum(state.x0)}) = ${formatNum(state.y0)}${
    Number.isFinite(slope) ? `    y′(x₀, y₀) = ${formatNum(slope)}` : ""
  }`;
}

function tickLength(x, y, slope) {
  const dpr = window.devicePixelRatio || 1;
  const target = 11 * dpr;
  const [ax, ay] = viewer.worldToScreen(x, y);
  const [bx, by] = viewer.worldToScreen(x + 1, y + slope);
  const pix = Math.hypot(bx - ax, by - ay);
  if (!Number.isFinite(pix) || pix < 1e-9) return 0;
  return target / pix;
}

function drawField() {
  if (!el.showField.checked || !state.data?.tickX?.length) return;
  const ctx = viewer.ctx;
  const dpr = window.devicePixelRatio || 1;
  ctx.save();
  ctx.strokeStyle = "rgba(157, 179, 255, 0.62)";
  ctx.lineWidth = 1.35 * dpr;
  ctx.lineCap = "round";
  const xs = state.data.tickX;
  const ys = state.data.tickY;
  const ss = state.data.tickSlope;
  for (let i = 0; i < xs.length; i += 1) {
    const slope = ss[i];
    if (!Number.isFinite(slope)) continue;
    const s = tickLength(xs[i], ys[i], slope);
    if (!s) continue;
    const [x0, y0] = viewer.worldToScreen(xs[i] - s, ys[i] - s * slope);
    const [x1, y1] = viewer.worldToScreen(xs[i] + s, ys[i] + s * slope);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }
  ctx.restore();
}

function takePrefix(arr, n) {
  if (!arr?.length) return [];
  return arr.slice(0, Math.max(1, Math.min(n, arr.length)));
}

function drawBranch(xs, ys, color, width, count) {
  if (!xs?.length || !ys?.length) return;
  const n = Number.isFinite(count) ? count : xs.length;
  viewer.drawLine(takePrefix(xs, n), takePrefix(ys, n), color, width, 0.96);
}

function methodVisible(name) {
  if (name === "euler") return el.showEuler.checked;
  if (name === "midpoint") return el.showMidpoint.checked;
  if (name === "rk4") return el.showRk4.checked;
  return false;
}

function drawSolutions() {
  const sols = state.data?.solutions;
  if (!sols) return;
  const both = el.bothWays.checked;
  const animCount = state.animating ? Math.max(1, state.stepIndex) : null;
  for (const name of ["euler", "midpoint", "rk4"]) {
    if (!methodVisible(name) || !sols[name]) continue;
    const meta = METHOD_META[name];
    const fwd = sols[name].forward;
    const back = sols[name].backward;
    drawBranch(fwd?.x, fwd?.y, meta.color, meta.width, animCount);
    if (both) drawBranch(back?.x, back?.y, meta.color, meta.width, animCount);
  }
}

function drawEulerHop() {
  if (!state.animating || !el.showEuler.checked) return;
  const euler = state.data?.solutions?.euler;
  if (!euler) return;
  const i = Math.max(0, state.stepIndex - 1);
  const drawHop = (branch, sign) => {
    const xs = branch?.x;
    const ys = branch?.y;
    const slopes = branch?.slopes;
    if (!xs || i >= xs.length - 1) return;
    const x = xs[i];
    const y = ys[i];
    const slope = slopes?.[i];
    if (![x, y].every(Number.isFinite)) return;
    const ctx = viewer.ctx;
    const dpr = window.devicePixelRatio || 1;
    if (Number.isFinite(slope)) {
      const h = (Number.isFinite(state.data?.h) ? state.data.h : stepH()) * sign;
      const [a0, b0] = viewer.worldToScreen(x, y);
      const [a1, b1] = viewer.worldToScreen(x + h, y + h * slope);
      ctx.save();
      ctx.strokeStyle = "rgba(245, 200, 66, 0.95)";
      ctx.setLineDash([5 * dpr, 4 * dpr]);
      ctx.lineWidth = 2.1 * dpr;
      ctx.beginPath();
      ctx.moveTo(a0, b0);
      ctx.lineTo(a1, b1);
      ctx.stroke();
      ctx.restore();
    }
    const x1 = xs[i + 1];
    const y1 = ys[i + 1];
    if (![x1, y1].every(Number.isFinite)) return;
    const [p0, q0] = viewer.worldToScreen(x, y);
    const [p1, q1] = viewer.worldToScreen(x1, y1);
    ctx.save();
    ctx.fillStyle = "#f5c842";
    ctx.beginPath();
    ctx.arc(p0, q0, 3.4 * dpr, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(p1, q1, 3.4 * dpr, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };
  drawHop(euler.forward, 1);
  if (el.bothWays.checked) drawHop(euler.backward, -1);
}

function drawIc() {
  const ctx = viewer.ctx;
  const dpr = window.devicePixelRatio || 1;
  const [sx, sy] = viewer.worldToScreen(state.x0, state.y0);
  ctx.save();
  ctx.beginPath();
  ctx.arc(sx, sy, 10 * dpr, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255, 255, 255, 0.16)";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(sx, sy, 6.2 * dpr, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#f5c842";
  ctx.lineWidth = 2.2 * dpr;
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawScene() {
  viewer.setupCanvasResolution();
  viewer.drawGrid();
  drawField();
  drawSolutions();
  drawEulerHop();
  drawIc();
  viewer.notifyView();
}

function animationMaxSteps() {
  const sols = state.data?.solutions || {};
  let max = 1;
  for (const name of selectedMethods()) {
    const sol = sols[name];
    if (!sol) continue;
    max = Math.max(max, sol.forward?.x?.length || 1);
    if (el.bothWays.checked) max = Math.max(max, sol.backward?.x?.length || 1);
  }
  return Math.max(1, max);
}

function frameLoop(ts) {
  if (!state.animating) return;
  if (state.paused) {
    state.lastTs = ts;
    state.rafId = requestAnimationFrame(frameLoop);
    return;
  }
  const dt = state.lastTs ? ts - state.lastTs : 0;
  state.lastTs = ts;
  state.elapsed += dt;
  const stepMs = Number(el.speedInput.value) || 90;
  while (state.elapsed >= stepMs && state.stepIndex < state.maxSteps) {
    state.elapsed -= stepMs;
    state.stepIndex += 1;
  }
  drawScene();
  setCounter(`step ${Math.min(state.stepIndex, state.maxSteps)} / ${state.maxSteps}`);
  if (state.stepIndex >= state.maxSteps) {
    stopAnimation();
    setStatus("animation finished. drag the initial condition to try another IVP.");
    drawScene();
    return;
  }
  state.rafId = requestAnimationFrame(frameLoop);
}

async function computeNow(options = {}) {
  const { solutionsOnly = false } = options;
  const payload = currentPayload();
  if (!payload.expr) {
    setStatus("Please enter y′ = f(x, y).");
    return false;
  }
  if (state.inFlight) {
    state.queued = true;
    state.queuedSolutionsOnly = solutionsOnly;
    return false;
  }
  const gen = ++state.computeGen;
  state.inFlight = true;
  if (!state.draggingIC) setStatus("computing slope field…");
  try {
    const result = await window.pywebview.api.compute_slope_field(payload);
    if (gen !== state.computeGen) return false;
    if (!result?.ok) {
      setStatus(`error: ${result?.error || "could not compute."}`);
      return false;
    }
    if (solutionsOnly && state.data?.tickX?.length) {
      state.data = {
        ...state.data,
        x0: result.x0,
        y0: result.y0,
        h: result.h,
        solutions: result.solutions,
        methods: result.methods,
        slopeAtIC: result.slopeAtIC,
      };
    } else {
      state.data = result;
      state.params = payload;
      state.lastViewKey = viewKey();
      viewer.setData(
        { xRange: result.xRange, yRange: result.yRange },
        payload,
        { preserveView: true },
      );
    }
    updateHeader();
    drawScene();
    const n = state.data.tickX?.length || 0;
    if (state.draggingIC) {
      setStatus(`initial condition (${formatNum(state.x0)}, ${formatNum(state.y0)}) — release to settle.`);
    } else {
      setStatus(`slope field ready · ${n} ticks · click or drag the white point.`);
    }
    return true;
  } catch (err) {
    if (gen === state.computeGen) setStatus(String(err));
    return false;
  } finally {
    state.inFlight = false;
    if (state.queued) {
      const only = state.queuedSolutionsOnly;
      state.queued = false;
      state.queuedSolutionsOnly = false;
      computeNow({ solutionsOnly: only });
    }
  }
}

function scheduleCompute({ debounceMs = 140, solutionsOnly = false } = {}) {
  clearTimeout(state.ivpTimer);
  if (debounceMs <= 0) {
    computeNow({ solutionsOnly });
    return;
  }
  state.ivpTimer = setTimeout(
    () => computeNow({ solutionsOnly }),
    debounceMs,
  );
}

function viewKey() {
  const v = viewer.view;
  return [v.xmin, v.xmax, v.ymin, v.ymax].map((n) => n.toFixed(4)).join(":");
}

function onViewChange() {
  const key = viewKey();
  if (key === state.lastViewKey) return;
  clearTimeout(state.fieldTimer);
  state.fieldTimer = setTimeout(() => {
    if (viewKey() === state.lastViewKey) return;
    stopAnimation();
    scheduleCompute({ debounceMs: 0 });
  }, 130);
}

async function runAnimation() {
  stopAnimation();
  const ok = await computeNow();
  if (!ok || !state.data) return;
  state.maxSteps = animationMaxSteps();
  state.stepIndex = 1;
  state.elapsed = 0;
  state.lastTs = 0;
  state.animating = true;
  state.paused = false;
  setCounter(`step 1 / ${state.maxSteps}`);
  setStatus("animating Euler hops against midpoint and RK4…");
  drawScene();
  state.rafId = requestAnimationFrame(frameLoop);
}

function wireCanvas() {
  const canvas = viewer.canvas;
  canvas.addEventListener(
    "mousedown",
    (event) => {
      if (event.button !== 0) return;
      if (icHit(event)) {
        event.stopImmediatePropagation();
        state.draggingIC = true;
        stopAnimation();
        canvas.style.cursor = "grabbing";
        return;
      }
      state.clickStart = { x: event.clientX, y: event.clientY };
    },
    true,
  );

  window.addEventListener("mousemove", (event) => {
    if (!state.draggingIC) return;
    const [x, y] = eventToWorld(event);
    setIc(x, y);
  });

  window.addEventListener("mouseup", (event) => {
    if (state.draggingIC) {
      state.draggingIC = false;
      canvas.style.cursor = "crosshair";
      const [x, y] = eventToWorld(event);
      setIc(x, y, { recompute: true });
      setStatus("initial condition set. press Animate to watch the steps.");
      return;
    }
    if (!state.clickStart) return;
    const dist = Math.hypot(event.clientX - state.clickStart.x, event.clientY - state.clickStart.y);
    const start = state.clickStart;
    state.clickStart = null;
    if (dist > 5) return;
    const rect = canvas.getBoundingClientRect();
    if (
      start.x < rect.left
      || start.x > rect.right
      || start.y < rect.top
      || start.y > rect.bottom
    ) {
      return;
    }
    stopAnimation();
    const [x, y] = eventToWorld(event);
    setIc(x, y);
    setStatus("initial condition set. press Animate to watch the steps.");
  });
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

  el.animateBtn.addEventListener("click", runAnimation);
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
    state.data = null;
    state.x0 = 0;
    state.y0 = 1;
    syncIcInputs();
    el.exprInput.value = "x - y";
    el.exprInput.dispatchEvent(new Event("input", { bubbles: true }));
    viewer.clearData();
    viewer.resetView({ xmin: -4, xmax: 4, ymin: -4, ymax: 4 });
    updateHeader();
    setCounter("");
    setStatus("reset.");
    scheduleCompute({ debounceMs: 0 });
  });

  el.hInput.addEventListener("input", () => {
    el.hValue.textContent = stepH().toFixed(2);
  });
  el.hInput.addEventListener("change", () => {
    stopAnimation();
    scheduleCompute({ debounceMs: 0 });
  });
  el.gridInput.addEventListener("input", () => {
    el.gridValue.textContent = el.gridInput.value;
  });
  el.gridInput.addEventListener("change", () => scheduleCompute({ debounceMs: 0 }));
  el.speedInput.addEventListener("input", () => {
    el.speedValue.textContent = `${el.speedInput.value} ms`;
  });

  [el.showEuler, el.showMidpoint, el.showRk4, el.showField, el.bothWays].forEach((box) => {
    box.addEventListener("change", () => {
      if (box === el.showEuler || box === el.showMidpoint || box === el.showRk4) {
        stopAnimation();
        scheduleCompute({ debounceMs: 0 });
        return;
      }
      drawScene();
    });
  });

  [el.x0Input, el.y0Input].forEach((input) => {
    input.addEventListener("change", () => {
      stopAnimation();
      setIc(Number(el.x0Input.value), Number(el.y0Input.value));
    });
  });

  el.exprInput.addEventListener("input", () => {
    stopAnimation();
    scheduleCompute({ debounceMs: 220 });
  });
  el.exprInput.addEventListener("change", () => scheduleCompute({ debounceMs: 0 }));
  el.exprInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") scheduleCompute({ debounceMs: 0 });
  });
}

async function bootstrap() {
  VizTransition.initPageTransition();
  el.homeBtn = $("homeBtn");
  el.exprInput = $("exprInput");
  el.x0Input = $("x0Input");
  el.y0Input = $("y0Input");
  el.hInput = $("hInput");
  el.hValue = $("hValue");
  el.gridInput = $("gridInput");
  el.gridValue = $("gridValue");
  el.showEuler = $("showEuler");
  el.showMidpoint = $("showMidpoint");
  el.showRk4 = $("showRk4");
  el.showField = $("showField");
  el.bothWays = $("bothWays");
  el.speedInput = $("speedInput");
  el.speedValue = $("speedValue");
  el.animateBtn = $("animateBtn");
  el.pauseBtn = $("pauseBtn");
  el.resetBtn = $("resetBtn");
  el.status = $("status");
  el.termCounter = $("termCounter");
  el.exprLine = $("exprLine");

  viewer = new GraphViewer($("plotCanvas"), {
    initialView: { xmin: -4, xmax: 4, ymin: -4, ymax: 4 },
  });
  viewer.canvas.style.cursor = "crosshair";
  viewer.setRedrawHandler(() => {
    if (!state.data) {
      viewer.drawGrid();
      return;
    }
    drawScene();
  });
  viewer.onViewChange = onViewChange;

  const boot = await window.pywebview.api.get_slope_field_bootstrap();
  const hints = $("functionHints");
  (boot?.hints || []).forEach((h) => {
    const op = document.createElement("option");
    op.value = h;
    hints.appendChild(op);
  });
  const presets = $("presets");
  (boot?.presets || []).forEach(([label, expr]) => {
    const btn = document.createElement("button");
    btn.className = "preset-btn";
    btn.textContent = label;
    btn.addEventListener("click", () => {
      el.exprInput.value = expr;
      el.exprInput.dispatchEvent(new Event("input", { bubbles: true }));
      stopAnimation();
      setStatus(`preset: y′ = ${expr}`);
      scheduleCompute({ debounceMs: 0 });
    });
    presets.appendChild(btn);
  });

  wireCanvas();
  wireInteractions();
  el.hValue.textContent = stepH().toFixed(2);
  updateHeader();
  await computeNow();
}

whenApiReady(bootstrap);
