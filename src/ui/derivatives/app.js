const anim = {
  animating: false,
  paused: false,
  rafId: null,
  frameIndex: 0,
  elapsed: 0,
  lastTs: 0,
  sampleXs: [],
};

const view = {
  showDerivatives: false,
  includeSecond: true,
};

const el = {};
let viewer;
let functionPreview;

function $(id) {
  return document.getElementById(id);
}

function formatNum(v, digits = 4) {
  if (!Number.isFinite(v)) return "NaN";
  return Number(v).toFixed(digits);
}

function setStatus(text) {
  el.status.textContent = text;
}

function setCounter(text) {
  el.termCounter.textContent = text;
}

function setConcavityText(text) {
  el.concavityStatus.textContent = text;
}

function yAt(xs, ys, x) {
  if (!xs?.length || !ys?.length) return null;
  if (x < xs[0] || x > xs[xs.length - 1]) return null;

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

function buildSampleXs(a, b, steps) {
  const count = Math.max(2, Math.floor(steps));
  const arr = [];
  for (let i = 0; i < count; i += 1) {
    const t = count === 1 ? 0 : i / (count - 1);
    arr.push(a + (b - a) * t);
  }
  return arr;
}

function drawCurrentState(sampleX) {
  if (!viewer?.data) return;
  const layers = [{ ys: viewer.data.yTrue, color: "#2ee8bb", width: 2.5, alpha: 0.88 }];
  if (view.showDerivatives) {
    layers.push({
      ys: viewer.data.firstDerivative,
      color: "#f5c842",
      width: 2.25,
      alpha: 0.95,
    });
    if (view.includeSecond && viewer.data.secondDerivative) {
      layers.push({
        ys: viewer.data.secondDerivative,
        color: "#f06090",
        width: 2.15,
        alpha: 0.92,
      });
    }
  }
  viewer.draw(layers);

  const xVals = viewer.data.x;
  const yTrue = yAt(xVals, viewer.data.yTrue, sampleX);
  const yPrime = yAt(xVals, viewer.data.firstDerivative, sampleX);
  const ySecond = view.includeSecond ? yAt(xVals, viewer.data.secondDerivative, sampleX) : null;
  if (yTrue === null || yPrime === null) {
    return;
  }

  const ctx = viewer.ctx;
  const dpr = window.devicePixelRatio || 1;
  const span = viewer.view.xmax - viewer.view.xmin;
  const tangentSpan = Math.max(0.4, span * 0.18);
  const xLeft = sampleX - tangentSpan;
  const xRight = sampleX + tangentSpan;
  const yLeft = yTrue + yPrime * (xLeft - sampleX);
  const yRight = yTrue + yPrime * (xRight - sampleX);
  const [sx0, sy0] = viewer.worldToScreen(xLeft, yLeft);
  const [sx1, sy1] = viewer.worldToScreen(xRight, yRight);
  const [sxPoint, syPoint] = viewer.worldToScreen(sampleX, yTrue);

  ctx.strokeStyle = "rgba(245, 200, 66, 0.9)";
  ctx.lineWidth = 2.3 * dpr;
  ctx.beginPath();
  ctx.moveTo(sx0, sy0);
  ctx.lineTo(sx1, sy1);
  ctx.stroke();

  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(sxPoint, syPoint, 4.2 * dpr, 0, Math.PI * 2);
  ctx.fill();

  const [sxPrime, syPrime] = viewer.worldToScreen(sampleX, yPrime);
  ctx.fillStyle = "#f5c842";
  ctx.beginPath();
  ctx.arc(sxPrime, syPrime, 4.0 * dpr, 0, Math.PI * 2);
  ctx.fill();

  if (view.includeSecond && ySecond !== null) {
    const [sxSecond, sySecond] = viewer.worldToScreen(sampleX, ySecond);
    ctx.fillStyle = "#f06090";
    ctx.beginPath();
    ctx.arc(sxSecond, sySecond, 4.0 * dpr, 0, Math.PI * 2);
    ctx.fill();
  }

  const showSecond = view.includeSecond && ySecond !== null;
  el.analysis.textContent = `x=${formatNum(sampleX)} | f(x)=${formatNum(yTrue)} | f'(x)=${formatNum(yPrime)}${
    showSecond ? ` | f''(x)=${formatNum(ySecond)}` : ""
  }`;
  if (!showSecond) {
    setConcavityText("Second derivative hidden.");
    return;
  }
  const curvature = ySecond > 1e-5
    ? "Concave Up"
    : ySecond < -1e-5
      ? "Concave Down"
      : "Inflection / Flat Curvature";
  setConcavityText(`Interval concavity: ${viewer.data.concavityInterval} | At x: ${curvature}`);
}

function previewPayload() {
  return {
    expr: el.exprInput.value.trim(),
    xmin: Number(el.xminInput.value),
    xmax: Number(el.xmaxInput.value),
    samples: 2200,
  };
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

function currentSampleX() {
  if (anim.sampleXs.length) {
    const i = Math.max(0, Math.min(anim.frameIndex, anim.sampleXs.length - 1));
    return anim.sampleXs[i];
  }
  return Number(el.aInput.value);
}

function redrawOverlay() {
  if (!viewer?.data) return;
  if (view.showDerivatives || anim.animating) {
    drawCurrentState(currentSampleX());
    return;
  }
  drawFunctionOnly();
}

function applySecondDerivativeVisibility() {
  view.includeSecond = Boolean(el.showSecondInput?.checked);
  redrawOverlay();
}

function drawFunctionOnly() {
  FunctionPreview.drawFunctionOnly(viewer);
  el.analysis.textContent = "f(x) plotted. Press Animate to start slope animation.";
  setConcavityText(
    view.includeSecond
      ? "Concavity insight appears when you animate."
      : "Second derivative hidden.",
  );
}

function frameLoop(ts) {
  if (!anim.animating || !viewer?.data) return;
  if (anim.paused) {
    anim.lastTs = ts;
    anim.rafId = requestAnimationFrame(frameLoop);
    return;
  }

  if (!anim.lastTs) anim.lastTs = ts;
  const dt = ts - anim.lastTs;
  anim.lastTs = ts;
  anim.elapsed += dt;

  const speed = Number(el.speedInput.value);
  if (anim.elapsed >= speed) {
    anim.elapsed = 0;
    anim.frameIndex += 1;
  }

  if (anim.frameIndex >= anim.sampleXs.length) {
    anim.frameIndex = 0;
    anim.elapsed = 0;
    anim.lastTs = ts;
    setStatus("looping derivative animation...");
  }

  const x = anim.sampleXs[anim.frameIndex];
  drawCurrentState(x);
  setCounter(`frame ${anim.frameIndex + 1} / ${anim.sampleXs.length}`);
  setStatus(`animating derivative at x=${formatNum(x, 3)}`);
  anim.rafId = requestAnimationFrame(frameLoop);
}

async function runAnimation() {
  const payload = {
    expr: el.exprInput.value.trim(),
    a: Number(el.aInput.value),
    b: Number(el.bInput.value),
    xmin: Number(el.xminInput.value),
    xmax: Number(el.xmaxInput.value),
    samples: 2200,
  };
  if (!payload.expr) {
    setStatus("Please enter a function.");
    return;
  }

  setStatus("computing derivatives...");
  const result = await window.pywebview.api.compute_derivatives(payload);
  if (!result?.ok) {
    setStatus(`error: ${result.error}`);
    return;
  }

  stopAnimation();
  view.includeSecond = Boolean(el.showSecondInput.checked);
  view.showDerivatives = false;
  viewer.setData(result, payload);
  LatexDisplay.setImage(el.latexImage, result.latexPng);
  drawFunctionOnly();
  await FunctionPreview.delay(FunctionPreview.PREVIEW_HOLD_MS);

  view.showDerivatives = true;
  anim.sampleXs = buildSampleXs(payload.a, payload.b, Number(el.stepsInput.value));
  anim.frameIndex = 0;
  anim.elapsed = 0;
  anim.lastTs = 0;
  anim.animating = true;

  const x0 = anim.sampleXs[0];
  drawCurrentState(x0);
  setCounter(`frame 1 / ${anim.sampleXs.length}`);
  setStatus("animating derivatives...");
  anim.rafId = requestAnimationFrame(frameLoop);
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
    view.showDerivatives = false;
    viewer.clearData();
    viewer.resetView();
    viewer.drawGrid();
    setStatus("reset.");
    setCounter("");
    el.analysis.textContent = "Pick a function, then press Animate.";
    setConcavityText(
      el.showSecondInput.checked
        ? "Concavity insight appears when you animate."
        : "Second derivative hidden.",
    );
  });

  el.stepsInput.addEventListener("input", () => {
    el.stepsValue.textContent = el.stepsInput.value;
  });
  el.speedInput.addEventListener("input", () => {
    el.speedValue.textContent = `${el.speedInput.value} ms`;
  });
  el.showSecondInput.addEventListener("change", applySecondDerivativeVisibility);
}

async function bootstrap() {
  VizTransition.initPageTransition();

  el.homeBtn = $("homeBtn");
  el.exprInput = $("exprInput");
  el.aInput = $("aInput");
  el.bInput = $("bInput");
  el.stepsInput = $("stepsInput");
  el.speedInput = $("speedInput");
  el.xminInput = $("xminInput");
  el.xmaxInput = $("xmaxInput");
  el.showSecondInput = $("showSecondInput");
  view.includeSecond = Boolean(el.showSecondInput.checked);
  el.animateBtn = $("animateBtn");
  el.pauseBtn = $("pauseBtn");
  el.resetBtn = $("resetBtn");
  el.status = $("status");
  el.termCounter = $("termCounter");
  el.analysis = $("analysis");
  el.concavityStatus = $("concavityStatus");
  el.latexImage = $("latexImage");
  el.stepsValue = $("stepsValue");
  el.speedValue = $("speedValue");

  viewer = new GraphViewer($("plotCanvas"));
  viewer.onDomainExpand = (payload) => {
    if (view.showDerivatives || anim.animating) {
      return window.pywebview.api.compute_derivatives({
        ...payload,
        a: Number(el.aInput.value),
        b: Number(el.bInput.value),
      });
    }
    return window.pywebview.api.preview_derivatives(payload);
  };
  viewer.onDataExpanded = (result, payload) => {
    viewer.setData(result, payload, { preserveView: true });
    LatexDisplay.setImage(el.latexImage, result.latexPng);
    redrawOverlay();
  };
  viewer.setRedrawHandler(() => {
    if (!viewer.data) {
      viewer.drawGrid();
      return;
    }
    redrawOverlay();
  });

  const boot = await window.pywebview.api.get_derivatives_bootstrap();
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

  functionPreview = FunctionPreview.wire({
    viewer,
    exprInput: el.exprInput,
    extraInputs: [el.xminInput, el.xmaxInput],
    getPayload: previewPayload,
    previewApi: (payload) => window.pywebview.api.preview_derivatives(payload),
    onBeforePlot: () => {
      stopAnimation();
      view.showDerivatives = false;
      setCounter("");
    },
    onPlotted: () => {
      drawFunctionOnly();
      LatexDisplay.setImage(el.latexImage, viewer.data?.latexPng);
      setStatus("f(x) plotted. press Animate.");
    },
    onError: (msg) => setStatus(`error: ${msg}`),
  });

  wireInteractions();
  viewer.drawGrid();
  functionPreview.plot();
}

whenApiReady(bootstrap);
