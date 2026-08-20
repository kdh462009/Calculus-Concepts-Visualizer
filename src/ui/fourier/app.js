/**
 * Fourier epicycles: JS draws and animates; Python owns DFT / resampling.
 * Reconstruction uses signed frequencies: z(θ) ≈ c₀ + Σ c_k e^{i k θ}.
 */

const TAU = Math.PI * 2;
const TRAIL_MAX = 900;

const state = {
  stroke: [],
  data: null,
  mode: "draw",
  paused: false,
  phase: 0,
  trail: [],
  width: 0,
  height: 0,
  dpr: 1,
  drawing: false,
  lastTs: 0,
  analyzing: false,
  analyzeGen: 0,
  loopActive: false,
};

const el = {};

function $(id) {
  return document.getElementById(id);
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function nearestPow2(v, lo = 64, hi = 2048) {
  v = clamp(Math.round(v), lo, hi);
  let p = 64;
  while (p << 1 <= v) p <<= 1;
  const next = Math.min(p << 1, hi);
  if (next <= p) return p;
  return v - p <= next - v ? p : next;
}

function setStatus(text, isError = false) {
  if (!el.status) return;
  el.status.textContent = text;
  el.status.classList.toggle("is-error", Boolean(isError));
}

function setMode(mode) {
  if (mode === "animate" && !state.data) return;
  state.mode = mode;
  el.canvas.classList.toggle("mode-animate", mode === "animate");
  el.pills.forEach((pill) => {
    const on = pill.getAttribute("data-mode") === mode;
    pill.classList.toggle("active", on);
    pill.setAttribute("aria-selected", on ? "true" : "false");
  });
  requestRender();
}

function syncAnalyzeEnabled() {
  el.btnAnalyze.disabled = state.stroke.length < 3 || state.analyzing;
}

function syncCanvasSize() {
  const prevW = state.width;
  const prevH = state.height;
  state.dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rect = el.canvas.getBoundingClientRect();
  state.width = rect.width;
  state.height = rect.height;
  el.canvas.width = Math.floor(state.width * state.dpr);
  el.canvas.height = Math.floor(state.height * state.dpr);
  el.ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
  if (
    prevW > 0
    && prevH > 0
    && state.stroke.length
    && (state.width !== prevW || state.height !== prevH)
  ) {
    const sx = state.width / prevW;
    const sy = state.height / prevH;
    state.stroke = state.stroke.map((p) => ({ x: p.x * sx, y: p.y * sy }));
  }
}

function toScreen(x, y) {
  const s = Math.min(state.width, state.height) * 0.42;
  return {
    x: state.width * 0.5 + x * s,
    y: state.height * 0.5 - y * s,
  };
}

function clientToCanvas(clientX, clientY) {
  const r = el.canvas.getBoundingClientRect();
  return { x: clientX - r.left, y: clientY - r.top };
}

function formatDc(dc) {
  if (!dc) return "--";
  const sign = dc.im >= 0 ? "+" : "−";
  return `${dc.re.toFixed(3)} ${sign} ${Math.abs(dc.im).toFixed(3)}i`;
}

function applyResult(result) {
  state.data = result;
  const maxT = Math.max(1, result.termCount || result.terms.length);
  el.terms.max = String(maxT);
  const want = clamp(parseInt(el.terms.value, 10) || maxT, 1, maxT);
  el.terms.value = String(want);
  el.termsReadout.textContent = `${want} / ${maxT}`;
  el.statPoints.textContent = String(result.pointCount ?? state.stroke.length);
  el.statDc.textContent = formatDc(result.dc);
  const mx = result.terms[0];
  el.statMax.textContent = mx
    ? `k=${mx.k}, |c|=${mx.amp.toFixed(4)}`
    : "--";
  state.trail = [];
  state.phase = 0;
  setMode("animate");
}

function clearDrawing() {
  state.stroke = [];
  state.data = null;
  state.trail = [];
  state.phase = 0;
  el.statPoints.textContent = "0";
  el.statDc.textContent = "--";
  el.statMax.textContent = "--";
  syncAnalyzeEnabled();
  setMode("draw");
  requestRender();
  setStatus("cleared.");
}

function drawBackground() {
  const ctx = el.ctx;
  const { width, height } = state;
  const g = ctx.createLinearGradient(0, 0, width, height);
  g.addColorStop(0, "rgba(20,24,44,0.5)");
  g.addColorStop(1, "rgba(8,10,18,0.85)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.strokeStyle = "rgba(124,156,255,0.06)";
  ctx.lineWidth = 1;
  const step = 48;
  for (let x = (width % step) * 0.5; x < width; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = (height % step) * 0.5; y < height; y += step) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = "rgba(93,240,213,0.12)";
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 10]);
  ctx.beginPath();
  ctx.arc(width * 0.5, height * 0.5, Math.min(width, height) * 0.42, 0, TAU);
  ctx.stroke();
  ctx.restore();
}

function drawStrokePreview() {
  if (state.stroke.length < 2) return;
  const ctx = el.ctx;
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.strokeStyle = "rgba(255,107,157,0.85)";
  ctx.shadowColor = "rgba(255,107,157,0.55)";
  ctx.shadowBlur = 18;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(state.stroke[0].x, state.stroke[0].y);
  for (let i = 1; i < state.stroke.length; i++) {
    ctx.lineTo(state.stroke[i].x, state.stroke[i].y);
  }
  const a = state.stroke[0];
  const b = state.stroke[state.stroke.length - 1];
  if (Math.hypot(a.x - b.x, a.y - b.y) > 3) {
    ctx.lineTo(a.x, a.y);
  }
  ctx.stroke();
  ctx.restore();
}

function epicyclePosition(theta, maxTerms) {
  const data = state.data;
  if (!data) return { x: 0, y: 0, chain: [] };
  let x = data.dc.re;
  let y = data.dc.im;
  const chain = [];
  const nUse = Math.min(maxTerms, data.terms.length);
  for (let i = 0; i < nUse; i++) {
    const { k, amp, phase } = data.terms[i];
    const cx = x;
    const cy = y;
    const ang = k * theta + phase;
    x += amp * Math.cos(ang);
    y += amp * Math.sin(ang);
    chain.push({ cx, cy, r: amp, x, y });
  }
  return { x, y, chain };
}

function drawFourierFrame(dt) {
  const data = state.data;
  if (!data) {
    drawBackground();
    return;
  }
  const maxTerms = clamp(
    parseInt(el.terms.value, 10) || 1,
    1,
    data.terms.length || 1,
  );
  const spd = (el.speed.valueAsNumber / 100) ** 1.4;
  if (!state.paused) {
    state.phase += 0.72 * spd * dt;
    if (state.phase > TAU) state.phase -= TAU * Math.floor(state.phase / TAU);
  }

  drawBackground();

  if (el.showOrig.checked && data.samples?.length) {
    el.ctx.save();
    el.ctx.strokeStyle = "rgba(255,107,157,0.35)";
    el.ctx.lineWidth = 2;
    el.ctx.setLineDash([4, 6]);
    el.ctx.beginPath();
    data.samples.forEach((p, i) => {
      const s = toScreen(p.re, p.im);
      if (i === 0) el.ctx.moveTo(s.x, s.y);
      else el.ctx.lineTo(s.x, s.y);
    });
    el.ctx.closePath();
    el.ctx.stroke();
    el.ctx.restore();
  }

  const pos = epicyclePosition(state.phase, maxTerms);
  const scale = Math.min(state.width, state.height) * 0.42;

  if (el.showCircles.checked) {
    el.ctx.save();
    el.ctx.lineWidth = 1.25;
    pos.chain.forEach((ch, i) => {
      const c0 = toScreen(ch.cx, ch.cy);
      const hue = 210 + (i * 37) % 120;
      el.ctx.strokeStyle = `hsla(${hue}, 70%, 62%, 0.28)`;
      el.ctx.beginPath();
      el.ctx.arc(c0.x, c0.y, ch.r * scale, 0, TAU);
      el.ctx.stroke();
    });
    el.ctx.restore();
  }

  if (el.showRays.checked) {
    el.ctx.save();
    el.ctx.lineWidth = 1.5;
    pos.chain.forEach((ch, i) => {
      const a = toScreen(ch.cx, ch.cy);
      const b = toScreen(ch.x, ch.y);
      const t = i / Math.max(1, pos.chain.length - 1);
      el.ctx.strokeStyle = `rgba(124,156,255,${0.25 + t * 0.45})`;
      el.ctx.beginPath();
      el.ctx.moveTo(a.x, a.y);
      el.ctx.lineTo(b.x, b.y);
      el.ctx.stroke();
    });
    el.ctx.restore();
  }

  if (!state.paused) {
    state.trail.push({ x: pos.x, y: pos.y });
    if (state.trail.length > TRAIL_MAX) {
      state.trail.splice(0, state.trail.length - TRAIL_MAX);
    }
  }

  el.ctx.save();
  el.ctx.lineJoin = "round";
  el.ctx.lineCap = "round";
  el.ctx.strokeStyle = "rgba(93,240,213,0.45)";
  el.ctx.lineWidth = 2;
  el.ctx.beginPath();
  for (let i = 1; i < state.trail.length; i++) {
    const a = toScreen(state.trail[i - 1].x, state.trail[i - 1].y);
    const b = toScreen(state.trail[i].x, state.trail[i].y);
    el.ctx.moveTo(a.x, a.y);
    el.ctx.lineTo(b.x, b.y);
  }
  el.ctx.stroke();
  el.ctx.restore();

  const tip = toScreen(pos.x, pos.y);
  el.ctx.save();
  const grd = el.ctx.createRadialGradient(tip.x, tip.y, 0, tip.x, tip.y, 22);
  grd.addColorStop(0, "rgba(255,255,255,0.95)");
  grd.addColorStop(0.35, "rgba(93,240,213,0.9)");
  grd.addColorStop(1, "rgba(93,240,213,0)");
  el.ctx.fillStyle = grd;
  el.ctx.beginPath();
  el.ctx.arc(tip.x, tip.y, 22, 0, TAU);
  el.ctx.fill();
  el.ctx.fillStyle = "#0a0c14";
  el.ctx.beginPath();
  el.ctx.arc(tip.x, tip.y, 5, 0, TAU);
  el.ctx.fill();
  el.ctx.restore();

  const dialR = Math.min(52, Math.min(state.width, state.height) * 0.06);
  const cx0 = state.width - dialR - 20;
  const cy0 = dialR + 20;
  el.ctx.save();
  el.ctx.strokeStyle = "rgba(124,156,255,0.35)";
  el.ctx.lineWidth = 3;
  el.ctx.beginPath();
  el.ctx.arc(cx0, cy0, dialR, -Math.PI / 2, -Math.PI / 2 + TAU, false);
  el.ctx.stroke();
  el.ctx.strokeStyle = "rgba(93,240,213,0.9)";
  el.ctx.lineWidth = 4;
  el.ctx.beginPath();
  el.ctx.arc(cx0, cy0, dialR, -Math.PI / 2, -Math.PI / 2 + state.phase, false);
  el.ctx.stroke();
  el.ctx.fillStyle = "rgba(232,236,255,0.85)";
  el.ctx.font = "500 11px ui-monospace, SF Mono, Menlo, monospace";
  el.ctx.textAlign = "center";
  el.ctx.fillText("θ / 2π", cx0, cy0 + dialR + 16);
  el.ctx.restore();
}

function needsAnimationLoop() {
  return state.mode === "animate" && Boolean(state.data) && !state.paused;
}

function paintFrame(ts) {
  const last = state.lastTs || ts;
  const dt = clamp((ts - last) / 1000, 0, 0.05);
  state.lastTs = ts;
  el.ctx.clearRect(0, 0, state.width, state.height);
  if (state.mode === "draw") {
    drawBackground();
    drawStrokePreview();
  } else if (state.data) {
    drawFourierFrame(dt);
  } else {
    drawBackground();
  }
}

function render(ts) {
  paintFrame(ts);
  if (needsAnimationLoop()) {
    state.loopActive = true;
    requestAnimationFrame(render);
  } else {
    state.loopActive = false;
  }
}

function requestRender() {
  if (state.loopActive && needsAnimationLoop() && !state.paused) return;
  state.lastTs = 0;
  requestAnimationFrame(render);
}

async function analyze() {
  if (state.stroke.length < 3 || state.analyzing) return;
  const gen = ++state.analyzeGen;
  const n = nearestPow2(parseInt(el.sampleN.value, 10) || 512);
  el.sampleN.value = String(n);
  el.nReadout.textContent = String(n);
  state.analyzing = true;
  syncAnalyzeEnabled();
  setStatus("computing DFT…");
  try {
    const result = await window.pywebview.api.compute_fourier({
      points: state.stroke,
      n,
      width: state.width,
      height: state.height,
    });
    if (gen !== state.analyzeGen) return;
    if (!result?.ok) {
      setStatus(result?.error || "Could not compute Fourier series.", true);
      return;
    }
    applyResult(result);
    requestRender();
    setStatus(`reconstructing with ${result.termCount} harmonics.`);
  } catch (err) {
    if (gen === state.analyzeGen) setStatus(String(err), true);
  } finally {
    if (gen === state.analyzeGen) {
      state.analyzing = false;
      syncAnalyzeEnabled();
    }
  }
}

async function loadPreset(id) {
  if (state.width < 2 || state.height < 2) {
    syncCanvasSize();
  }
  if (state.width < 2 || state.height < 2) {
    setStatus("canvas is still laying out; try again.", true);
    return;
  }
  setStatus("loading preset…");
  try {
    const result = await window.pywebview.api.get_fourier_preset({
      id,
      width: state.width,
      height: state.height,
    });
    if (!result?.ok) {
      setStatus(result?.error || "Could not load preset.", true);
      return;
    }
    state.stroke = result.points;
    state.data = null;
    state.trail = [];
    syncAnalyzeEnabled();
    setMode("draw");
    el.statPoints.textContent = String(state.stroke.length);
    requestRender();
    setStatus(`${id} ready. Press Compute Fourier.`);
  } catch (err) {
    setStatus(String(err), true);
  }
}

function pointerDown(event) {
  if (state.mode !== "draw") return;
  state.drawing = true;
  try {
    el.canvas.setPointerCapture(event.pointerId);
  } catch (_) {
    /* some webviews reject capture */
  }
  state.stroke = [clientToCanvas(event.clientX, event.clientY)];
  syncAnalyzeEnabled();
}

function pointerMove(event) {
  if (!state.drawing || state.mode !== "draw") return;
  const p = clientToCanvas(event.clientX, event.clientY);
  const last = state.stroke[state.stroke.length - 1];
  if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 1.5) {
    state.stroke.push(p);
    requestRender();
  }
  syncAnalyzeEnabled();
}

function pointerUp() {
  const wasDrawing = state.drawing;
  state.drawing = false;
  if (wasDrawing && state.mode === "draw" && state.stroke.length >= 3) {
    const a = state.stroke[0];
    const b = state.stroke[state.stroke.length - 1];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (d > 2 && d < 36) state.stroke[state.stroke.length - 1] = { x: a.x, y: a.y };
  }
  syncAnalyzeEnabled();
  requestRender();
}

function wireInteractions() {
  if (el.homeBtn) {
    el.homeBtn.addEventListener("click", async () => {
      if (typeof window.pywebview.api.go_home === "function") {
        await VizTransition.navigateWithWoosh(VizTransition.back, () => (
          window.pywebview.api.go_home()
        ));
      }
    });
  }

  el.btnAnalyze.addEventListener("click", () => {
    if (state.stroke.length < 3) return;
    analyze();
  });
  el.btnClear.addEventListener("click", () => clearDrawing());
  el.btnPause.addEventListener("click", () => {
    state.paused = !state.paused;
    el.btnPause.textContent = state.paused ? "Resume" : "Pause";
    setStatus(state.paused ? "paused." : "resumed.");
    requestRender();
  });
  el.btnResetPhase.addEventListener("click", () => {
    state.phase = 0;
    state.trail = [];
    setStatus("phase reset.");
    requestRender();
  });

  el.terms.addEventListener("input", () => {
    const maxT = state.data?.terms.length || parseInt(el.terms.max, 10) || 1;
    el.termsReadout.textContent = `${el.terms.value} / ${maxT}`;
    requestRender();
  });

  el.sampleN.addEventListener("input", () => {
    const snapped = nearestPow2(parseInt(el.sampleN.value, 10) || 512);
    el.nReadout.textContent = String(snapped);
  });
  el.sampleN.addEventListener("change", () => {
    const snapped = nearestPow2(parseInt(el.sampleN.value, 10) || 512);
    el.sampleN.value = String(snapped);
    el.nReadout.textContent = String(snapped);
  });

  el.speed.addEventListener("input", () => {
    const s = el.speed.valueAsNumber / 100;
    el.speedReadout.textContent = `${s.toFixed(2)}×`;
  });

  [el.showCircles, el.showRays, el.showOrig].forEach((input) => {
    input?.addEventListener("change", () => requestRender());
  });

  el.pills.forEach((pill) => {
    pill.addEventListener("click", () => {
      const mode = pill.getAttribute("data-mode");
      if (mode === "draw") setMode("draw");
      if (mode === "animate" && state.data) setMode("animate");
    });
  });

  el.canvas.addEventListener("pointerdown", pointerDown);
  el.canvas.addEventListener("pointermove", pointerMove);
  el.canvas.addEventListener("pointerup", pointerUp);
  el.canvas.addEventListener("pointercancel", pointerUp);

  window.addEventListener("keydown", (event) => {
    if (event.target instanceof HTMLElement && event.target.matches("input, textarea, select")) {
      return;
    }
    if (event.code === "Space") {
      event.preventDefault();
      el.btnPause.click();
    }
    if (event.key === "r" || event.key === "R") el.btnResetPhase.click();
    if (event.key === "c" || event.key === "C") clearDrawing();
    if (event.key === "Enter" && state.mode === "draw" && state.stroke.length >= 3 && !event.repeat) {
      el.btnAnalyze.click();
    }
  });

  window.addEventListener("resize", () => {
    syncCanvasSize();
    requestRender();
  });
  if (typeof ResizeObserver !== "undefined") {
    new ResizeObserver(() => {
      syncCanvasSize();
      requestRender();
    }).observe(el.canvas);
  }
}

function renderPresets(presets) {
  el.presets.replaceChildren();
  (presets || []).forEach((preset) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "fourier-btn";
    btn.textContent = preset.label || preset.id;
    btn.addEventListener("click", () => loadPreset(preset.id));
    el.presets.appendChild(btn);
  });
}

async function bootstrap() {
  VizTransition.initPageTransition();
  el.homeBtn = $("homeBtn");
  el.canvas = $("canvas");
  el.ctx = el.canvas.getContext("2d");
  el.btnAnalyze = $("btnAnalyze");
  el.btnClear = $("btnClear");
  el.btnPause = $("btnPause");
  el.btnResetPhase = $("btnResetPhase");
  el.terms = $("terms");
  el.sampleN = $("sampleN");
  el.speed = $("speed");
  el.termsReadout = $("termsReadout");
  el.nReadout = $("nReadout");
  el.speedReadout = $("speedReadout");
  el.showCircles = $("showCircles");
  el.showRays = $("showRays");
  el.showOrig = $("showOrig");
  el.statPoints = $("statPoints");
  el.statDc = $("statDc");
  el.statMax = $("statMax");
  el.status = $("status");
  el.presets = $("presets");
  el.latexImage = $("latexImage");
  el.pills = [...document.querySelectorAll(".fourier-pill")];

  wireInteractions();
  syncCanvasSize();
  syncAnalyzeEnabled();

  let boot;
  try {
    boot = await window.pywebview.api.get_fourier_bootstrap();
  } catch (err) {
    setStatus(String(err), true);
    requestRender();
    return;
  }
  renderPresets(boot?.presets);
  LatexDisplay.setImage(el.latexImage, boot?.latexPng);
  if (boot?.nDefault) {
    el.sampleN.value = String(boot.nDefault);
    el.nReadout.textContent = String(boot.nDefault);
  }

  const startLoop = () => {
    syncCanvasSize();
    if (state.width < 2 || state.height < 2) {
      requestAnimationFrame(startLoop);
      return;
    }
    requestRender();
  };
  startLoop();
  setStatus("ready. Draw a closed curve or pick a preset.");
}

whenApiReady(bootstrap);
