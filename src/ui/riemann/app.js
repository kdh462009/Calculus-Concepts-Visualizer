const anim = {
  animating: false,
  paused: false,
  rafId: null,
  lastTs: 0,
  elapsed: 0,
  nValues: [],
  index: 0,
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

function errorPercent(integral, estimate, absFIntegral) {
  const err = estimate - integral;
  const absErr = Math.abs(err);
  const absInt = Math.abs(integral);
  const absArea = Math.abs(absFIntegral ?? 0);

  if (absErr < 1e-12 && absInt < 1e-12) {
    return { pct: 0, basis: "exact" };
  }
  if (absArea > 1e-9 && absInt < 0.05 * absArea) {
    return { pct: (absErr / absArea) * 100, basis: "area" };
  }
  if (absInt > 1e-6) {
    return { pct: (absErr / absInt) * 100, basis: "integral" };
  }
  return { pct: (absErr / Math.max(Math.abs(estimate), 1e-9)) * 100, basis: "sum" };
}

function formatAnalysis(integral, estimate, sumType, n, absFIntegral) {
  const err = estimate - integral;
  const verdict = err > 0 ? "OVER-estimate" : err < 0 ? "UNDER-estimate" : "Exact";
  const { pct, basis } = errorPercent(integral, estimate, absFIntegral);

  let errText;
  if (basis === "exact") {
    errText = "Exact";
  } else if (basis === "area") {
    errText = `${verdict} by ~${pct.toFixed(2)}% of ∫|f|dx`;
  } else if (basis === "sum") {
    errText = `${verdict} by ~${pct.toFixed(2)}% (integral ≈ 0)`;
  } else {
    errText = `${verdict} by ~${pct.toFixed(2)}%`;
  }

  return `Integral ≈ ${formatNum(integral)} | ${sumType} sum (n=${n}) ≈ ${formatNum(estimate)} | ${errText}`;
}

function stopAnimation() {
  anim.animating = false;
  anim.paused = false;
  anim.lastTs = 0;
  anim.elapsed = 0;
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

function polygon(points, fill, stroke, alpha = 0.3) {
  const ctx = viewer.ctx;
  if (!points.length) return;
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i += 1) {
    ctx.lineTo(points[i][0], points[i][1]);
  }
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.globalAlpha = alpha;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1.2 * (window.devicePixelRatio || 1);
  ctx.stroke();
}

function riemannEstimate(n, sumType, a, b) {
  if (n < 1) return Number.NaN;
  const dx = (b - a) / n;
  let sum = 0;

  if (sumType === "trapezoidal") {
    for (let i = 0; i <= n; i += 1) {
      const xVal = a + i * dx;
      const y = yAt(xVal);
      if (y === null || !Number.isFinite(y)) return Number.NaN;
      if (i === 0 || i === n) sum += y;
      else sum += 2 * y;
    }
    return 0.5 * dx * sum;
  }

  for (let i = 0; i < n; i += 1) {
    const x0 = a + i * dx;
    const x1 = x0 + dx;
    let sx = x0;
    if (sumType === "right") sx = x1;
    if (sumType === "midpoint") sx = (x0 + x1) * 0.5;
    const y = yAt(sx);
    if (y === null || !Number.isFinite(y)) return Number.NaN;
    sum += y;
  }
  return sum * dx;
}

function previewPayload() {
  return {
    expr: el.exprInput.value.trim(),
    xmin: Number(el.xminInput.value),
    xmax: Number(el.xmaxInput.value),
    samples: 2200,
  };
}

function renderFunctionOnly() {
  if (!viewer?.data) return;
  viewer.setupCanvasResolution();
  viewer.drawGrid();
  viewer.drawLine(viewer.data.x, viewer.data.yTrue, "#2ee8bb", 2.55, 0.92);
  el.analysis.textContent = "f(x) plotted — press Animate for Riemann sums";
  setCounter("");
}

function drawRiemannShapes(n, sumType, a, b) {
  const dx = (b - a) / n;
  const fillPos = "rgba(124, 106, 247, 0.30)";
  const fillNeg = "rgba(240, 96, 144, 0.34)";
  const stroke = "rgba(220, 230, 255, 0.72)";
  const y0 = 0;
  const baseline = viewer.worldToScreen(a, y0)[1];

  for (let i = 0; i < n; i += 1) {
    const left = a + i * dx;
    const right = left + dx;
    const sLeft = viewer.worldToScreen(left, y0)[0];
    const sRight = viewer.worldToScreen(right, y0)[0];

    if (sumType === "trapezoidal") {
      const hLeft = yAt(left);
      const hRight = yAt(right);
      if (hLeft === null || hRight === null) continue;
      const p1 = viewer.worldToScreen(left, hLeft);
      const p2 = viewer.worldToScreen(right, hRight);
      const avg = (hLeft + hRight) * 0.5;
      const fill = avg >= 0 ? fillPos : fillNeg;
      polygon(
        [[sLeft, baseline], [p1[0], p1[1]], [p2[0], p2[1]], [sRight, baseline]],
        fill,
        stroke,
        0.32,
      );
      continue;
    }

    let sx = left;
    if (sumType === "right") sx = right;
    if (sumType === "midpoint") sx = (left + right) * 0.5;
    const h = yAt(sx);
    if (h === null) continue;
    const sy = viewer.worldToScreen(left, h)[1];
    const fill = h >= 0 ? fillPos : fillNeg;
    polygon(
      [[sLeft, baseline], [sLeft, sy], [sRight, sy], [sRight, baseline]],
      fill,
      stroke,
      0.29,
    );
  }
}

function renderFrame(n) {
  if (!viewer?.data) return;
  if (!view.showApprox) {
    renderFunctionOnly();
    return;
  }
  const sumType = el.sumTypeInput.value;
  const a = Number(el.aInput.value);
  const b = Number(el.bInput.value);

  viewer.setupCanvasResolution();
  viewer.drawGrid();
  drawRiemannShapes(n, sumType, a, b);
  viewer.drawLine(viewer.data.x, viewer.data.yTrue, "#2ee8bb", 2.55, 0.85);

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

  const estimate = riemannEstimate(n, sumType, a, b);
  const integral = viewer.data.integralRef;
  el.analysis.textContent = formatAnalysis(
    integral,
    estimate,
    sumType,
    n,
    viewer.data.absFIntegral,
  );
  setCounter(`n ${n}  (target: n → ∞)`);
}

function nextAnimationValues(n0, nMax) {
  const values = [];
  const start = Math.max(1, Math.floor(n0));
  const stop = Math.max(start, Math.floor(nMax));
  for (let n = start; n <= stop; n += 1) values.push(n);
  return values;
}

function riemannPayload(extra = {}) {
  return {
    expr: el.exprInput.value.trim(),
    sumType: el.sumTypeInput.value,
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
    anim.index = 0;
    anim.elapsed = 0;
    anim.lastTs = ts;
    setStatus("looping animation... higher n gets closer to the integral.");
  }

  const n = anim.nValues[anim.index];
  renderFrame(n);
  setStatus(`animating... n=${n}`);
  anim.rafId = requestAnimationFrame(frameLoop);
}

async function runAnimation() {
  const payload = riemannPayload();

  if (!payload.expr) {
    setStatus("Please enter a function.");
    return;
  }

  setStatus("computing integral and initial sum...");
  const result = await window.pywebview.api.compute_riemann(payload);
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
  setStatus("showing f(x)...");
  await FunctionPreview.delay(FunctionPreview.PREVIEW_HOLD_MS);

  view.showApprox = true;
  anim.animating = true;
  renderFrame(anim.nValues[0]);
  setStatus("animating...");
  anim.rafId = requestAnimationFrame(frameLoop);
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
    el.analysis.textContent = "Set values and press Animate.";
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
  el.sumTypeInput = $("sumTypeInput");
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
  el.nValue = $("nValue");
  el.nMaxValue = $("nMaxValue");
  el.speedValue = $("speedValue");

  viewer = new GraphViewer($("plotCanvas"));
  viewer.onDomainExpand = (payload) => {
    if (anim.animating || view.showApprox) {
      return window.pywebview.api.compute_riemann(riemannPayload(payload));
    }
    return window.pywebview.api.preview_function(payload);
  };
  viewer.onDataExpanded = (result, payload) => {
    viewer.setData(result, payload, { preserveView: true });
    if (anim.animating || view.showApprox) {
      if (anim.nValues.length) {
        const i = Math.max(0, Math.min(anim.index, anim.nValues.length - 1));
        renderFrame(anim.nValues[i]);
      } else {
        renderFunctionOnly();
      }
    } else {
      renderFunctionOnly();
    }
  };
  viewer.setRedrawHandler(() => {
    if (!viewer.data) {
      viewer.drawGrid();
      return;
    }
    if (anim.animating || view.showApprox) {
      if (anim.nValues.length) {
        const i = Math.max(0, Math.min(anim.index, anim.nValues.length - 1));
        renderFrame(anim.nValues[i]);
      } else {
        renderFunctionOnly();
      }
    } else {
      renderFunctionOnly();
    }
  });

  const boot = await window.pywebview.api.get_riemann_bootstrap();
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
      functionPreview.schedule();
    });
    presets.appendChild(btn);
  });

  const existingOptions = new Set([...el.sumTypeInput.options].map((op) => op.value));
  boot.sumTypes.forEach(([value, label]) => {
    if (existingOptions.has(value)) return;
    const op = document.createElement("option");
    op.value = value;
    op.textContent = label;
    el.sumTypeInput.appendChild(op);
  });

  functionPreview = FunctionPreview.wire({
    viewer,
    exprInput: el.exprInput,
    extraInputs: [el.xminInput, el.xmaxInput],
    getPayload: previewPayload,
    previewApi: (payload) => window.pywebview.api.preview_function(payload),
    onBeforePlot: () => {
      stopAnimation();
      view.showApprox = false;
      anim.nValues = [];
      setCounter("");
    },
    onPlotted: () => {
      renderFunctionOnly();
      setStatus("f(x) plotted. press Animate for Riemann sums.");
    },
    onError: (msg) => setStatus(`error: ${msg}`),
  });

  wireInteractions();
  viewer.drawGrid();
  functionPreview.plot();
}

whenApiReady(bootstrap);
