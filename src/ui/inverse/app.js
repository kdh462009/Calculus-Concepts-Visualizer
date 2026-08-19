const LEGEND = {
  function: [{ color: "#2ee8bb", label: "f(x)" }],
  inverse: [
    { color: "#2ee8bb", label: "f(x)" },
    { color: "#f5c842", label: "y = x" },
    { color: "#9e8dff", label: "inverse" },
  ],
  inverseDerivative: [
    { color: "#2ee8bb", label: "f(x)" },
    { color: "#9e8dff", label: "inverse" },
    { color: "#f5c842", label: "f'(x)" },
    { color: "#7cc7ff", label: "inverse derivative" },
  ],
};

const state = {
  data: null,
  stage: "function",
  computeTimer: null,
};

const el = {};
let viewer;

function $(id) {
  return document.getElementById(id);
}

function setStatus(text) {
  el.status.textContent = text;
}

function updateScaleReadout() {
  if (!viewer?.view) return;
  const v = viewer.view;
  el.scaleLine.textContent =
    `Scale: x [${v.xmin.toFixed(2)}, ${v.xmax.toFixed(2)}], y [${v.ymin.toFixed(2)}, ${v.ymax.toFixed(2)}]`;
}

function applyStageView(stage) {
  if (!state.data?.phaseYRanges || !viewer) return;
  const yRange = state.data.phaseYRanges[stage] || state.data.yRange;
  const xRange = state.data.xRange;
  if (!xRange || !yRange) return;
  viewer.view = {
    xmin: xRange[0],
    xmax: xRange[1],
    ymin: yRange[0],
    ymax: yRange[1],
  };
}

function updateStageButton() {
  if (!el.stageBtn) return;
  if (!state.data || state.stage === "function") {
    el.stageBtn.textContent = "Plot Inverse";
    el.stageBtn.disabled = !state.data;
    return;
  }
  if (state.stage === "inverse") {
    el.stageBtn.textContent = "Plot Inverse Derivative";
    el.stageBtn.disabled = false;
    return;
  }
  el.stageBtn.textContent = "Plot Inverse Derivative";
  el.stageBtn.disabled = true;
}

function renderLegend(stage) {
  const items = state.data ? (LEGEND[stage] || []) : [];
  el.plotLegend.replaceChildren(
    ...items.map((item) => {
      const row = document.createElement("div");
      row.className = "plot-legend-item";
      const swatch = document.createElement("span");
      swatch.className = "plot-legend-swatch";
      swatch.style.background = item.color;
      const label = document.createElement("span");
      label.textContent = item.label;
      row.append(swatch, label);
      return row;
    }),
  );
  el.plotLegend.hidden = items.length === 0;
}

function drawStage(stage = state.stage) {
  if (!state.data) {
    viewer.draw([]);
    renderLegend(null);
    el.phaseLine.textContent = "";
    updateScaleReadout();
    updateStageButton();
    return;
  }

  state.stage = stage;
  let layers = [];

  if (stage === "function") {
    layers = [{ ys: state.data.yTrue, color: "#2ee8bb", width: 2.9, alpha: 1.0 }];
    el.phaseLine.textContent = "Stage 1: f(x)";
  } else if (stage === "inverse") {
    layers = [
      { ys: state.data.yTrue, color: "#2ee8bb", width: 2.4, alpha: 0.28 },
      { ys: state.data.yMirror, color: "#f5c842", width: 1.8, alpha: 0.9 },
      { ys: state.data.yInverse, color: "#9e8dff", width: 2.9, alpha: 1.0 },
    ];
    el.phaseLine.textContent = "Stage 2: inverse across y = x";
  } else {
    layers = [
      { ys: state.data.yTrue, color: "#2ee8bb", width: 2.4, alpha: 0.55 },
      { ys: state.data.yInverse, color: "#9e8dff", width: 2.4, alpha: 0.55 },
      { ys: state.data.yPrime, color: "#f5c842", width: 2.6, alpha: 1.0 },
      { ys: state.data.yInversePrime, color: "#7cc7ff", width: 4.0, alpha: 1.0 },
    ];
    el.phaseLine.textContent = "Stage 3: f'(x) and inverse derivative";
  }

  viewer.draw(layers);
  renderLegend(stage);
  updateScaleReadout();
  updateStageButton();
}

function payloadFromInputs() {
  return {
    expr: el.exprInput.value.trim(),
    xmin: Number(el.xminInput.value),
    xmax: Number(el.xmaxInput.value),
    samples: 1800,
  };
}

async function computeModel({ resetStage = true } = {}) {
  const payload = payloadFromInputs();
  if (!payload.expr) {
    setStatus("Please enter a function.");
    return false;
  }
  setStatus("computing function + inverse...");
  const result = await window.pywebview.api.compute_inverse(payload);
  if (!result.ok) {
    state.data = null;
    viewer.clearData();
    viewer.draw([]);
    renderLegend(null);
    updateStageButton();
    setStatus(`error: ${result.error}`);
    return false;
  }

  state.data = result;
  if (resetStage) state.stage = "function";
  viewer.setData(result, payload, { preserveView: !resetStage });
  if (resetStage) applyStageView(state.stage);
  drawStage(state.stage);
  el.ruleLine.textContent = result.inverseDerivativeRule;
  el.exprLine.textContent = `f'(x): ${result.derivativeExpr}  |  monotonicity: ${result.monotonicity}`;
  setStatus(state.stage === "function" ? "f(x) plotted. Plot Inverse when ready." : "updated.");
  return true;
}

function scheduleCompute() {
  clearTimeout(state.computeTimer);
  state.computeTimer = setTimeout(() => {
    computeModel({ resetStage: true });
  }, 160);
}

function advanceStage() {
  if (!state.data) return;
  if (state.stage === "function") {
    state.stage = "inverse";
    applyStageView("inverse");
    drawStage("inverse");
    setStatus("inverse plotted.");
    return;
  }
  if (state.stage === "inverse") {
    state.stage = "inverseDerivative";
    applyStageView("inverseDerivative");
    drawStage("inverseDerivative");
    setStatus("inverse derivative plotted.");
  }
}

function resetStages() {
  if (!state.data) {
    computeModel({ resetStage: true });
    return;
  }
  state.stage = "function";
  applyStageView("function");
  drawStage("function");
  setStatus("reset to f(x).");
}

function wireInteractions() {
  if (el.homeBtn) {
    el.homeBtn.addEventListener("click", async () => {
      if (typeof window.pywebview.api.go_home === "function") {
        await VizTransition.navigateWithWoosh(VizTransition.back, () => {
          window.pywebview.api.go_home();
        });
      }
    });
  }

  el.stageBtn.addEventListener("click", advanceStage);
  el.resetBtn.addEventListener("click", resetStages);
  el.exprInput.addEventListener("input", scheduleCompute);
  el.xminInput.addEventListener("input", scheduleCompute);
  el.xmaxInput.addEventListener("input", scheduleCompute);
}

async function bootstrap() {
  VizTransition.initPageTransition();
  el.homeBtn = $("homeBtn");
  el.exprInput = $("exprInput");
  el.xminInput = $("xminInput");
  el.xmaxInput = $("xmaxInput");
  el.stageBtn = $("stageBtn");
  el.resetBtn = $("resetBtn");
  el.status = $("status");
  el.phaseLine = $("phaseLine");
  el.scaleLine = $("scaleLine");
  el.plotLegend = $("plotLegend");
  el.ruleLine = $("ruleLine");
  el.exprLine = $("exprLine");

  viewer = new GraphViewer($("plotCanvas"));
  viewer.setRedrawHandler(() => drawStage(state.stage));
  viewer.onDomainExpand = (payload) => window.pywebview.api.compute_inverse(payload);
  viewer.onDataExpanded = (result, payload) => {
    if (!result?.ok) return;
    state.data = result;
    viewer.setData(result, payload, { preserveView: true });
    drawStage(state.stage);
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
      computeModel({ resetStage: true });
    });
    presets.appendChild(btn);
  });

  wireInteractions();
  await computeModel({ resetStage: true });
}

whenApiReady(bootstrap);
