const state = {
  data: null,
  animating: false,
  paused: false,
  rafId: null,
  elapsed: 0,
  lastTs: 0,
  progress: 0,
  phase: "function",
};

const el = {};
let viewer;

function $(id) {
  return document.getElementById(id);
}

function setStatus(text) {
  el.status.textContent = text;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function easeInOut(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2;
}

function phaseAtProgress(progress) {
  const p = clamp(progress, 0, 1);
  if (p < 0.34) {
    return { phase: "function", local: p / 0.34 };
  }
  if (p < 0.67) {
    return { phase: "inverse", local: (p - 0.34) / 0.33 };
  }
  return { phase: "inverseDerivative", local: (p - 0.67) / 0.33 };
}

function applyPhaseView(phase) {
  if (!state.data?.phaseYRanges || !viewer) return;
  const yRange = state.data.phaseYRanges[phase] || state.data.yRange;
  const xRange = state.data.xRange;
  if (!xRange || !yRange) return;
  viewer.view = {
    xmin: xRange[0],
    xmax: xRange[1],
    ymin: yRange[0],
    ymax: yRange[1],
  };
}

function updateScaleReadout() {
  if (!viewer?.view) return;
  const v = viewer.view;
  el.scaleLine.textContent =
    `Scale: x [${v.xmin.toFixed(2)}, ${v.xmax.toFixed(2)}], y [${v.ymin.toFixed(2)}, ${v.ymax.toFixed(2)}]`;
}

function stopAnimation() {
  state.animating = false;
  state.paused = false;
  state.lastTs = 0;
  if (state.rafId) cancelAnimationFrame(state.rafId);
  state.rafId = null;
  el.pauseBtn.textContent = "Pause";
}

function drawFromProgress(progress) {
  if (!state.data) {
    viewer.draw([]);
    el.legendLine.textContent = "Legend: --";
    updateScaleReadout();
    return;
  }

  const seg = phaseAtProgress(progress);
  state.phase = seg.phase;

  const t = easeInOut(clamp(seg.local, 0, 1));
  let layers = [];

  if (seg.phase === "function") {
    layers = [{ ys: state.data.yTrue, color: "#2ee8bb", width: 2.9, alpha: 1.0 }];
    el.phaseLine.textContent = "Phase 1: normal function f(x)";
    el.legendLine.textContent = "Legend: cyan = f(x)";
  } else if (seg.phase === "inverse") {
    layers = [
      { ys: state.data.yTrue, color: "#2ee8bb", width: 2.4, alpha: 0.35 * (1 - t) + 0.15 },
      { ys: state.data.yMirror, color: "#f5c842", width: 1.8, alpha: 0.5 + 0.4 * t },
      { ys: state.data.yInverse, color: "#9e8dff", width: 2.9, alpha: 0.25 + 0.75 * t },
    ];
    el.phaseLine.textContent = "Phase 2: inverse f^{-1}(x) reflected across y=x";
    el.legendLine.textContent = "Legend: purple = f^{-1}(x), yellow = y=x, cyan = f(x) reference";
  } else {
    layers = [
      { ys: state.data.yTrue, color: "#2ee8bb", width: 2.4, alpha: 0.72 },
      { ys: state.data.yInverse, color: "#9e8dff", width: 2.6, alpha: 0.82 },
      { ys: state.data.yInversePrime, color: "#7cc7ff", width: 4.2, alpha: 0.35 + 0.65 * t },
    ];
    el.phaseLine.textContent = "Phase 3: show all three, with bold derivative of inverse";
    el.legendLine.textContent = "Legend: cyan = f(x), purple = f^{-1}(x), bold blue = (f^{-1})'(x)";
  }

  viewer.draw(layers);
  updateScaleReadout();
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

  const duration = Number(el.speedInput.value);
  const norm = clamp(state.elapsed / duration, 0, 1);
  state.progress = easeInOut(norm);
  const nextPhase = phaseAtProgress(state.progress).phase;
  if (nextPhase !== state.phase) {
    state.phase = nextPhase;
    applyPhaseView(nextPhase);
  }
  drawFromProgress(state.progress);
  setStatus(norm < 1 ? "animating inverse relationship..." : "animation complete.");

  if (norm >= 1) {
    stopAnimation();
    return;
  }
  state.rafId = requestAnimationFrame(loop);
}

function payloadFromInputs() {
  return {
    expr: el.exprInput.value.trim(),
    xmin: Number(el.xminInput.value),
    xmax: Number(el.xmaxInput.value),
    samples: 1800,
  };
}

async function computeModel() {
  const payload = payloadFromInputs();
  if (!payload.expr) {
    setStatus("Please enter a function.");
    return false;
  }
  setStatus("computing function + inverse derivatives...");
  const result = await window.pywebview.api.compute_inverse(payload);
  if (!result.ok) {
    setStatus(`error: ${result.error}`);
    return false;
  }

  state.data = result;
  state.progress = 0;
  state.elapsed = 0;
  state.phase = "function";
  viewer.setData(result, payload);
  applyPhaseView("function");
  drawFromProgress(0);
  el.ruleLine.textContent = result.inverseDerivativeRule;
  el.exprLine.textContent = `f'(x): ${result.derivativeExpr}  |  monotonicity: ${result.monotonicity}`;
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
    state.progress = 0;
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
    state.elapsed = 0;
    state.phase = "function";
    applyPhaseView("function");
    drawFromProgress(0);
    setStatus("reset.");
  });

  el.speedInput.addEventListener("input", () => {
    el.speedValue.textContent = `${el.speedInput.value} ms`;
  });
}

async function bootstrap() {
  VizTransition.initPageTransition();
  el.homeBtn = $("homeBtn");
  el.exprInput = $("exprInput");
  el.xminInput = $("xminInput");
  el.xmaxInput = $("xmaxInput");
  el.speedInput = $("speedInput");
  el.speedValue = $("speedValue");
  el.computeBtn = $("computeBtn");
  el.animateBtn = $("animateBtn");
  el.pauseBtn = $("pauseBtn");
  el.resetBtn = $("resetBtn");
  el.status = $("status");
  el.phaseLine = $("phaseLine");
  el.scaleLine = $("scaleLine");
  el.legendLine = $("legendLine");
  el.ruleLine = $("ruleLine");
  el.exprLine = $("exprLine");

  viewer = new GraphViewer($("plotCanvas"));
  viewer.setRedrawHandler(() => drawFromProgress(state.progress));
  viewer.onDomainExpand = (payload) => window.pywebview.api.compute_inverse(payload);
  viewer.onDataExpanded = (result, payload) => {
    if (!result?.ok) return;
    state.data = result;
    viewer.setData(result, payload, { preserveView: true });
    drawFromProgress(state.progress);
  };
  viewer.drawGrid();

  const boot = await window.pywebview.api.get_inverse_bootstrap();
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
  await computeModel();
}

whenApiReady(bootstrap);
