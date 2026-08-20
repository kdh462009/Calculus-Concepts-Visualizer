const anim = {
  animating: false,
  paused: false,
  rafId: null,
  lastTs: 0,
  elapsed: 0,
  nValues: [],
  index: 0,
  stage: "curve",
};

const view = {
  showApprox: false,
};

const el = {};
let viewer;
let functionPreview;

function $(id) {
  return document.getElementById(id);
}

function setStatus(text) {
  el.status.textContent = text;
}

function setCounter(text) {
  el.termCounter.textContent = text;
}

function formatNum(v, digits = 6) {
  if (!Number.isFinite(v)) return "NaN";
  return Number(v).toFixed(digits);
}

function formatAnalysis(lengthRef, estimate, n) {
  const err = estimate - lengthRef;
  const absErr = Math.abs(err);
  const absL = Math.abs(lengthRef);
  let errText = "Exact";
  if (absErr >= 1e-12) {
    const pct = absL > 1e-9 ? (absErr / absL) * 100 : absErr * 100;
    const verdict = err > 0 ? "OVER" : "UNDER";
    errText = `${verdict} by ~${pct.toFixed(2)}%`;
  }
  return `L ≈ ${formatNum(lengthRef)}  |  L_n (n=${n}) ≈ ${formatNum(estimate)}  |  ${errText}`;
}

function stopAnimation() {
  anim.animating = false;
  anim.paused = false;
  anim.lastTs = 0;
  anim.elapsed = 0;
  anim.stage = "curve";
  if (anim.rafId) cancelAnimationFrame(anim.rafId);
  anim.rafId = null;
  el.pauseBtn.textContent = "Pause";
}

function yAt(x) {
  if (!viewer?.data?.x || !viewer?.data?.yTrue) return null;
  const xs = viewer.data.x;
  const ys = viewer.data.yTrue;
  if (!xs.length || x < xs[0] || x > xs[xs.length - 1]) return null;
  let lo = 0;
  let hi = xs.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] === x) return ys[mid];
    if (xs[mid] < x) lo = mid + 1;
    else hi = mid - 1;
  }
  const i = Math.max(1, lo);
  const x0 = xs[i - 1];
  const x1 = xs[i];
  const y0 = ys[i - 1];
  const y1 = ys[i];
  if (y0 === null || y1 === null || x1 === x0) return null;
  const t = (x - x0) / (x1 - x0);
  return y0 * (1 - t) + y1 * t;
}

function polygonalLength(n, a, b) {
  if (n < 1) return Number.NaN;
  const dx = (b - a) / n;
  let sum = 0;
  let yPrev = yAt(a);
  if (yPrev === null || !Number.isFinite(yPrev)) return Number.NaN;
  for (let i = 1; i <= n; i += 1) {
    const x1 = a + i * dx;
    const y1 = yAt(x1);
    if (y1 === null || !Number.isFinite(y1)) return Number.NaN;
    sum += Math.hypot(dx, y1 - yPrev);
    yPrev = y1;
  }
  return sum;
}

function previewPayload() {
  return {
    expr: el.exprInput.value.trim(),
    a: Number(el.aInput.value),
    b: Number(el.bInput.value),
    xmin: Number(el.xminInput.value),
    xmax: Number(el.xmaxInput.value),
    samples: 2200,
  };
}

function updateFormula(data) {
  LatexDisplay.setImage(el.latexImage, data?.latexPng ?? viewer?.data?.latexPng);
}

function renderFunctionOnly() {
  if (!viewer?.data) return;
  viewer.setupCanvasResolution();
  viewer.drawGrid();
  viewer.drawLine(viewer.data.x, viewer.data.yTrue, "#2ee8bb", 2.55, 0.92);
  drawBounds();
  const deriv = viewer.data.derivExpr;
  updateFormula(viewer.data);
  el.analysis.textContent = deriv
    ? `f(x) plotted · f′(x) = ${deriv}. Press Animate to build L_n`
    : "f(x) plotted. Press Animate to build L_n";
  setCounter("");
}

function drawBounds() {
  const a = Number(el.aInput.value);
  const b = Number(el.bInput.value);
  const [ax] = viewer.worldToScreen(a, 0);
  const [bx] = viewer.worldToScreen(b, 0);
  const ctx = viewer.ctx;
  ctx.strokeStyle = "rgba(245, 200, 66, 0.75)";
  ctx.lineWidth = 1.3 * (window.devicePixelRatio || 1);
  ctx.beginPath();
  ctx.moveTo(ax, 0);
  ctx.lineTo(ax, viewer.canvas.height);
  ctx.moveTo(bx, 0);
  ctx.lineTo(bx, viewer.canvas.height);
  ctx.stroke();
}

function drawChords(n, a, b) {
  const dx = (b - a) / n;
  const ctx = viewer.ctx;
  const dpr = window.devicePixelRatio || 1;
  const pts = [];
  for (let i = 0; i <= n; i += 1) {
    const xv = a + i * dx;
    const yv = yAt(xv);
    if (yv === null || !Number.isFinite(yv)) return;
    pts.push(viewer.worldToScreen(xv, yv));
  }
  if (pts.length < 2) return;

  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.strokeStyle = "rgba(183, 150, 255, 0.95)";
  ctx.lineWidth = 2.4 * dpr;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i += 1) {
    ctx.lineTo(pts[i][0], pts[i][1]);
  }
  ctx.stroke();

  const r = Math.max(2.2, 4.2 - n * 0.04) * dpr;
  ctx.fillStyle = "#f5c842";
  for (const [sx, sy] of pts) {
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function renderFrame(n) {
  if (!viewer?.data) return;
  if (!view.showApprox) {
    renderFunctionOnly();
    return;
  }
  const a = Number(el.aInput.value);
  const b = Number(el.bInput.value);

  viewer.setupCanvasResolution();
  viewer.drawGrid();
  viewer.drawLine(viewer.data.x, viewer.data.yTrue, "#2ee8bb", 2.2, 0.38);
  drawChords(n, a, b);
  drawBounds();

  const estimate = polygonalLength(n, a, b);
  const lengthRef = viewer.data.lengthRef;
  updateFormula(viewer.data);
  el.analysis.textContent = formatAnalysis(lengthRef, estimate, n);
  setCounter(`n ${n} chords  (target: n → ∞)`);
}

function nextAnimationValues(n0, nMax) {
  const start = Math.max(1, Math.floor(n0));
  const stop = Math.max(start, Math.floor(nMax));
  const values = [start];
  let n = start;
  while (n < stop) {
    const step = n < 8 ? 1 : n < 24 ? 2 : n < 64 ? 4 : Math.max(8, Math.floor(n * 0.12));
    n = Math.min(stop, n + step);
    values.push(n);
  }
  return values;
}

function arcPayload(extra = {}) {
  return {
    expr: el.exprInput.value.trim(),
    a: Number(el.aInput.value),
    b: Number(el.bInput.value),
    n: Number(el.nInput.value),
    xmin: Number(el.xminInput.value),
    xmax: Number(el.xmaxInput.value),
    samples: 2200,
    ...extra,
  };
}

function frameLoop(ts) {
  if (!anim.animating) return;
  if (!anim.lastTs) anim.lastTs = ts;
  const dt = ts - anim.lastTs;
  anim.lastTs = ts;

  if (anim.paused) {
    anim.rafId = requestAnimationFrame(frameLoop);
    return;
  }

  anim.elapsed += dt;
  const speed = Number(el.speedInput.value);
  if (anim.elapsed >= speed) {
    anim.elapsed = 0;
    anim.index += 1;
  }

  if (anim.index >= anim.nValues.length) {
    anim.index = anim.nValues.length - 1;
    const n = anim.nValues[anim.index];
    renderFrame(n);
    stopAnimation();
    view.showApprox = true;
    setStatus("smooth approximation; raise max n or Animate again.");
    return;
  }

  const n = anim.nValues[anim.index];
  renderFrame(n);
  const label =
    anim.index === 0
      ? `few segments · n=${n}`
      : anim.index >= anim.nValues.length - 1
        ? `smooth approximation · n=${n}`
        : `more segments · n=${n}`;
  setStatus(`animating… ${label}`);
  anim.rafId = requestAnimationFrame(frameLoop);
}

async function runAnimation() {
  const payload = arcPayload();
  if (!payload.expr) {
    setStatus("Please enter a function.");
    return;
  }

  setStatus("computing arc length integral…");
  const result = await window.pywebview.api.compute_arc_length(payload);
  if (!result.ok) {
    setStatus(`error: ${result.error}`);
    return;
  }

  viewer.setData(result, payload);
  const nStart = Number(el.nInput.value);
  const nEnd = Number(el.nMaxInput.value);
  anim.nValues = nextAnimationValues(nStart, nEnd);
  anim.index = 0;
  anim.elapsed = 0;
  anim.lastTs = 0;

  stopAnimation();
  view.showApprox = false;
  renderFunctionOnly();
  setStatus("showing the curve…");
  await FunctionPreview.delay(Math.max(FunctionPreview.PREVIEW_HOLD_MS, 420));

  view.showApprox = true;
  anim.animating = true;
  renderFrame(anim.nValues[0]);
  setStatus(`animating… few segments · n=${anim.nValues[0]}`);
  anim.rafId = requestAnimationFrame(frameLoop);
}

function currentN() {
  if (anim.nValues.length) {
    return anim.nValues[Math.max(0, Math.min(anim.index, anim.nValues.length - 1))];
  }
  return Number(el.nInput.value);
}

function redrawScene() {
  if (!viewer.data) {
    viewer.drawGrid();
    return;
  }
  if (anim.animating || view.showApprox) {
    renderFrame(currentN());
  } else {
    renderFunctionOnly();
  }
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
    if (!anim.animating) {
      setStatus("nothing to pause. press Animate first.");
      return;
    }
    anim.paused = !anim.paused;
    el.pauseBtn.textContent = anim.paused ? "Resume" : "Pause";
    setStatus(anim.paused ? "paused." : "resumed.");
  });

  el.resetBtn.addEventListener("click", () => {
    stopAnimation();
    view.showApprox = false;
    viewer.clearData();
    viewer.resetView();
    viewer.drawGrid();
    setStatus("reset.");
    setCounter("");
    el.analysis.textContent = "Pick a curve, then press Animate.";
    updateFormula(null);
  });

  el.nInput.addEventListener("input", () => {
    el.nValue.textContent = el.nInput.value;
  });
  el.nMaxInput.addEventListener("input", () => {
    el.nMaxValue.textContent = el.nMaxInput.value;
  });
  el.speedInput.addEventListener("input", () => {
    el.speedValue.textContent = `${el.speedInput.value} ms`;
  });
}

async function bootstrap() {
  VizTransition.initPageTransition();

  el.homeBtn = $("homeBtn");
  el.exprInput = $("exprInput");
  el.aInput = $("aInput");
  el.bInput = $("bInput");
  el.nInput = $("nInput");
  el.nMaxInput = $("nMaxInput");
  el.speedInput = $("speedInput");
  el.xminInput = $("xminInput");
  el.xmaxInput = $("xmaxInput");
  el.animateBtn = $("animateBtn");
  el.pauseBtn = $("pauseBtn");
  el.resetBtn = $("resetBtn");
  el.status = $("status");
  el.termCounter = $("termCounter");
  el.analysis = $("analysis");
  el.latexImage = $("latexImage");
  el.nValue = $("nValue");
  el.nMaxValue = $("nMaxValue");
  el.speedValue = $("speedValue");

  viewer = new GraphViewer($("plotCanvas"));
  viewer.onDomainExpand = (payload) => {
    if (anim.animating || view.showApprox) {
      return window.pywebview.api.compute_arc_length(arcPayload(payload));
    }
    return window.pywebview.api.preview_arc_length(payload);
  };
  viewer.onDataExpanded = (result, payload) => {
    viewer.setData(result, payload, { preserveView: true });
    redrawScene();
  };
  viewer.setRedrawHandler(redrawScene);

  const boot = await window.pywebview.api.get_arc_length_bootstrap();
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
      setStatus(`preset: ${expr}`);
    });
    presets.appendChild(btn);
  });

  functionPreview = FunctionPreview.wire({
    viewer,
    exprInput: el.exprInput,
    extraInputs: [el.aInput, el.bInput, el.xminInput, el.xmaxInput],
    getPayload: previewPayload,
    previewApi: (payload) => window.pywebview.api.preview_arc_length(payload),
    onBeforePlot: () => {
      stopAnimation();
      view.showApprox = false;
      anim.nValues = [];
      setCounter("");
    },
    onPlotted: () => {
      renderFunctionOnly();
      setStatus("f(x) plotted. press Animate for arc length.");
    },
    onError: (msg) => setStatus(`error: ${msg}`),
  });

  wireInteractions();
  viewer.drawGrid();
  functionPreview.plot();
}

whenApiReady(bootstrap);
