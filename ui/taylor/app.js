const anim = {
  animating: false,
  paused: false,
  rafId: null,
  termIndex: 0,
  elapsedInTerm: 0,
  lastTs: 0,
};

const view = {
  showApprox: false,
};

const el = {};
let functionPreview;

function $(id) {
  return document.getElementById(id);
}

function setStatus(text) {
  el.status.textContent = text;
}

function setTermCounter(text) {
  el.termCounter.textContent = text;
}

function easeGravity(t) {
  if (t < 0.72) {
    return ((t / 0.72) ** 2) * 0.82;
  }
  const tail = (t - 0.72) / 0.28;
  return 0.82 + (1 - (1 - tail) ** 3) * 0.18;
}

function blendedCurve(curA, curB, t) {
  const out = new Array(curA.length);
  for (let i = 0; i < curA.length; i += 1) {
    const a = curA[i];
    const b = curB[i];
    if (a === null || b === null) {
      out[i] = null;
    } else {
      out[i] = a * (1 - t) + b * t;
    }
  }
  return out;
}

function previewPayload() {
  return {
    expr: el.exprInput.value.trim(),
    xmin: Number(el.xminInput.value),
    xmax: Number(el.xmaxInput.value),
    samples: 1400,
  };
}

function currentDisplayedCurve() {
  if (!viewer.data || !view.showApprox) return null;
  const partials = viewer.data.partials;
  if (!partials || !partials.length) return null;
  const idx = Math.min(anim.termIndex, partials.length - 1);
  if (idx < partials.length - 1 && anim.animating && !anim.paused) {
    const speed = Number(el.speedInput.value);
    const progress = speed > 0 ? Math.max(0, Math.min(1, anim.elapsedInTerm / speed)) : 1;
    return blendedCurve(partials[idx], partials[idx + 1], easeGravity(progress));
  }
  return partials[idx];
}

function drawTaylorFrame(approxCurve) {
  const layers = [];
  if (viewer.data?.yTrue) {
    layers.push({ ys: viewer.data.yTrue, color: "#2ee8bb", width: 2.5, alpha: 0.74 });
  }
  if (approxCurve) {
    layers.push({ ys: approxCurve, color: "#372061", width: 3.15, alpha: 1.0 });
  }
  viewer.draw(layers);
}

let viewer;

function stopAnimation() {
  anim.animating = false;
  anim.paused = false;
  anim.lastTs = 0;
  if (anim.rafId) cancelAnimationFrame(anim.rafId);
  anim.rafId = null;
  el.pauseBtn.textContent = "⏸ PAUSE";
}

function loop(ts) {
  if (!anim.animating || !viewer.data) return;
  if (anim.paused) {
    anim.lastTs = ts;
    anim.rafId = requestAnimationFrame(loop);
    return;
  }

  if (!anim.lastTs) anim.lastTs = ts;
  const dt = ts - anim.lastTs;
  anim.lastTs = ts;

  const speed = Number(el.speedInput.value);
  const partials = viewer.data.partials;
  const maxTerm = partials.length - 1;

  if (anim.termIndex < maxTerm) {
    anim.elapsedInTerm += dt;
    while (anim.elapsedInTerm >= speed && anim.termIndex < maxTerm) {
      anim.elapsedInTerm -= speed;
      anim.termIndex += 1;
    }
  }

  let curve = partials[anim.termIndex];
  let displayTerm = anim.termIndex + 1;

  if (anim.termIndex < maxTerm) {
    const progress = Math.max(0, Math.min(1, anim.elapsedInTerm / speed));
    const eased = easeGravity(progress);
    curve = blendedCurve(partials[anim.termIndex], partials[anim.termIndex + 1], eased);
    displayTerm = anim.termIndex + 1 + (eased > 0.999 ? 1 : 0);
  }

  drawTaylorFrame(curve);
  setStatus(`animating... term ${Math.min(displayTerm, partials.length)}`);
  setTermCounter(`term ${Math.min(displayTerm, partials.length)} / ${partials.length}`);

  if (anim.termIndex >= maxTerm && anim.elapsedInTerm >= speed) {
    stopAnimation();
    setStatus("animation complete.");
    return;
  }

  anim.rafId = requestAnimationFrame(loop);
}

async function runAnimation() {
  const payload = {
    expr: el.exprInput.value.trim(),
    center: Number(el.centerInput.value),
    terms: Number(el.termsInput.value),
    xmin: Number(el.xminInput.value),
    xmax: Number(el.xmaxInput.value),
    samples: 1400,
  };
  if (!payload.expr) {
    setStatus("Please enter a function.");
    return;
  }

  setStatus("computing series...");
  const result = await window.pywebview.api.compute(payload);
  if (!result.ok) {
    setStatus(`error: ${result.error}`);
    return;
  }

  viewer.setData(result, payload);
  anim.termIndex = 0;
  anim.elapsedInTerm = 0;
  anim.lastTs = 0;
  stopAnimation();
  view.showApprox = false;
  FunctionPreview.drawFunctionOnly(viewer);
  setStatus("showing f(x)...");
  setTermCounter("");
  await FunctionPreview.delay(FunctionPreview.PREVIEW_HOLD_MS);

  view.showApprox = true;
  el.latexImage.src = result.latexPng;
  anim.animating = true;
  setStatus("animating...");
  setTermCounter(`term 1 / ${result.termCount}`);
  el.pauseBtn.textContent = "⏸ PAUSE";
  anim.rafId = requestAnimationFrame(loop);
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
      setStatus("nothing to pause. press ANIMATE first.");
      return;
    }
    anim.paused = !anim.paused;
    el.pauseBtn.textContent = anim.paused ? "▶ RESUME" : "⏸ PAUSE";
    setStatus(anim.paused ? "paused." : "resumed.");
  });

  el.resetBtn.addEventListener("click", () => {
    stopAnimation();
    view.showApprox = false;
    viewer.clearData();
    viewer.resetView();
    drawTaylorFrame(null);
    el.latexImage.src = "";
    setStatus("reset.");
    setTermCounter("");
  });

  el.termsInput.addEventListener("input", () => {
    el.termsValue.textContent = el.termsInput.value;
  });
  el.speedInput.addEventListener("input", () => {
    el.speedValue.textContent = `${el.speedInput.value} ms`;
  });
}

async function bootstrap() {
  VizTransition.initPageTransition();

  el.homeBtn = $("homeBtn");
  el.exprInput = $("exprInput");
  el.centerInput = $("centerInput");
  el.termsInput = $("termsInput");
  el.speedInput = $("speedInput");
  el.xminInput = $("xminInput");
  el.xmaxInput = $("xmaxInput");
  el.animateBtn = $("animateBtn");
  el.pauseBtn = $("pauseBtn");
  el.resetBtn = $("resetBtn");
  el.status = $("status");
  el.termCounter = $("termCounter");
  el.latexImage = $("latexImage");
  el.termsValue = $("termsValue");
  el.speedValue = $("speedValue");

  viewer = new GraphViewer($("plotCanvas"));
  viewer.onDomainExpand = (payload) => {
    if (anim.animating || view.showApprox) {
      return window.pywebview.api.compute(payload);
    }
    return window.pywebview.api.preview_function(payload);
  };
  viewer.onDataExpanded = (result, payload) => {
    if (result.termCount) {
      anim.termIndex = Math.min(anim.termIndex, Math.max(0, result.termCount - 1));
    }
    viewer.setData(result, payload);
    if (anim.animating || view.showApprox) {
      drawTaylorFrame(currentDisplayedCurve());
    } else {
      FunctionPreview.drawFunctionOnly(viewer);
    }
  };
  viewer.setRedrawHandler(() => {
    if (!viewer.data) {
      viewer.drawGrid();
      return;
    }
    if (anim.animating || view.showApprox) {
      drawTaylorFrame(currentDisplayedCurve());
    } else {
      FunctionPreview.drawFunctionOnly(viewer);
    }
  });

  const boot = await window.pywebview.api.get_bootstrap();
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
    previewApi: (payload) => window.pywebview.api.preview_function(payload),
    onBeforePlot: () => {
      stopAnimation();
      view.showApprox = false;
      el.latexImage.src = "";
      setTermCounter("");
    },
    onPlotted: () => setStatus("f(x) plotted. press ANIMATE for Taylor approximation."),
    onError: (msg) => setStatus(`error: ${msg}`),
  });

  wireInteractions();
  viewer.drawGrid();
  functionPreview.plot();
}

whenApiReady(bootstrap);
