/**
 * Monte Carlo integration experiment.
 *
 * Python returns the math envelope (curve, box, reference).
 * JS owns seeded PRNG, classification, animation, and stats.
 *
 * Phases:
 *   IDLE → SETUP → SAMPLING_SLOW → SAMPLING_ACCELERATING →
 *   SAMPLING_FAST → FINAL_PAUSE → CONVERGENCE → RESULT
 */

const SPEED_PROFILE = {
  slow: [8, 20, 45, 90],
  normal: [20, 80, 350, 1600],
  fast: [80, 400, 1800, 8000],
};

const PHASE = {
  IDLE: "IDLE",
  SETUP: "SETUP",
  SAMPLING_SLOW: "SAMPLING_SLOW",
  SAMPLING_ACCELERATING: "SAMPLING_ACCELERATING",
  SAMPLING_FAST: "SAMPLING_FAST",
  FINAL_PAUSE: "FINAL_PAUSE",
  CONVERGENCE: "CONVERGENCE",
  RESULT: "RESULT",
};

const SLOW_COUNT = 20;
const ACCEL_COUNT = 140;

const state = {
  data: null,
  experiment: null,
  phase: PHASE.IDLE,
  animating: false,
  paused: false,
  rafId: null,
  lastTs: 0,
  phaseT: 0,
  speed: "normal",
  seed: 184729,
  rng: null,
  nTarget: 10000,
  nDone: 0,
  nInside: 0,
  pointsX: null,
  pointsY: null,
  pointsIn: null,
  falling: [],
  errorHistory: [],
  display: {
    samples: 0,
    inside: 0,
    ratio: 0,
    estimate: 0,
    errorPct: 0,
  },
  revealExact: false,
  exactFade: 0,
  convProgress: 0,
  boundPulse: 0,
  rectEdges: 0,
  shadeAlpha: 0,
  phaseLabelUntil: 0,
  slowGap: 0,
  formulaBeat: 0,
};

const el = {};
let viewer;

function $(id) {
  return document.getElementById(id);
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function easeOutCubic(t) {
  return 1 - (1 - t) ** 3;
}

function setStatus(text) {
  el.status.textContent = text;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function formatInt(n) {
  return Math.round(n).toLocaleString("en-US");
}

function formatNum(v, digits = 4) {
  if (!Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  if (abs !== 0 && (abs >= 1e4 || abs < 1e-3)) return v.toExponential(2);
  return v.toFixed(digits);
}

function formatPct(v) {
  if (!Number.isFinite(v)) return "—";
  if (v < 0.01) return `${v.toFixed(3)}%`;
  if (v < 1) return `${v.toFixed(2)}%`;
  return `${v.toFixed(2)}%`;
}

function payloadFromInputs() {
  return {
    expr: el.exprInput.value.trim(),
    a: Number(el.aInput.value),
    b: Number(el.bInput.value),
    xmin: Number(el.xminInput.value),
    xmax: Number(el.xmaxInput.value),
    n: Number(el.nInput.value),
  };
}

function evalCurve(x) {
  const xs = state.data?.curveX;
  const ys = state.data?.curveY;
  if (!xs?.length || !ys?.length) return null;
  if (x <= xs[0]) return ys[0];
  if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
  let lo = 0;
  let hi = xs.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] <= x) lo = mid;
    else hi = mid;
  }
  const t = (x - xs[lo]) / Math.max(xs[hi] - xs[lo], 1e-12);
  const ya = ys[lo];
  const yb = ys[hi];
  if (ya == null || yb == null) return null;
  return lerp(ya, yb, t);
}

function isSamplingPhase(phase = state.phase) {
  return (
    phase === PHASE.SAMPLING_SLOW
    || phase === PHASE.SAMPLING_ACCELERATING
    || phase === PHASE.SAMPLING_FAST
  );
}

function setPhase(next) {
  state.phase = next;
  state.phaseT = 0;
}

function syncExperimentPanel() {
  const exp = state.experiment;
  if (!exp) {
    el.expExpr.textContent = "—";
    el.expBounds.textContent = "—";
    el.expN.textContent = "—";
    el.expSeed.textContent = "—";
    return;
  }
  el.expExpr.textContent = exp.expr;
  el.expBounds.textContent = `[${formatNum(exp.a, 3)}, ${formatNum(exp.b, 3)}]`;
  el.expN.textContent = formatInt(exp.n);
  el.expSeed.textContent = String(exp.seed);
}

function boxArea() {
  return state.data?.boxArea || 0;
}

function currentEstimate() {
  if (state.nDone <= 0) return 0;
  return (state.nInside / state.nDone) * boxArea();
}

function currentErrorPct() {
  const ref = state.data?.integralRef;
  const est = currentEstimate();
  if (!Number.isFinite(ref) || Math.abs(ref) < 1e-12) {
    return Math.abs(est - (ref || 0)) * 100;
  }
  return (Math.abs(est - ref) / Math.abs(ref)) * 100;
}

function resetStatsDisplay(blank = true) {
  if (blank) {
    state.display = { samples: 0, inside: 0, ratio: 0, estimate: 0, errorPct: 0 };
    el.statSamples.textContent = "—";
    el.statInside.textContent = "—";
    el.statRatio.textContent = "—";
    el.statEstimate.textContent = "—";
    el.statError.textContent = "—";
    [el.statSamples, el.statInside, el.statRatio, el.statEstimate, el.statError]
      .forEach((node) => node.classList.remove("is-live"));
    el.meterDot.classList.remove("is-on");
    el.meterExact.classList.remove("is-on");
    el.meterExact.style.opacity = "0";
    el.convCanvas.hidden = true;
    el.finalPanel.hidden = true;
    el.finalPanel.classList.remove("is-emphasize");
    return;
  }
  el.statSamples.textContent = "0";
  el.statInside.textContent = "0";
  el.statRatio.textContent = "0%";
  el.statEstimate.textContent = formatNum(0);
  el.statError.textContent = "—";
}

function updateStatsUI(dt) {
  if (state.phase === PHASE.IDLE || (state.nDone <= 0 && state.phase === PHASE.SETUP)) {
    return;
  }
  const target = {
    samples: state.nDone,
    inside: state.nInside,
    ratio: state.nDone ? (state.nInside / state.nDone) * 100 : 0,
    estimate: currentEstimate(),
    errorPct: currentErrorPct(),
  };
  // First samples: snap hard so ratio swings (100% → 50% → …) are obvious.
  const snap = state.phase === PHASE.SAMPLING_SLOW || state.nDone <= SLOW_COUNT;
  const k = snap ? 1 : (1 - Math.exp(-(dt || 1 / 60) * 9));
  state.display.samples = lerp(state.display.samples, target.samples, k);
  state.display.inside = lerp(state.display.inside, target.inside, k);
  state.display.ratio = lerp(state.display.ratio, target.ratio, k);
  state.display.estimate = lerp(
    state.display.estimate,
    target.estimate,
    snap ? 1 : Math.min(1, k * 1.15),
  );
  state.display.errorPct = lerp(state.display.errorPct, target.errorPct, k);

  const live = isSamplingPhase()
    || state.phase === PHASE.FINAL_PAUSE
    || state.phase === PHASE.CONVERGENCE
    || state.phase === PHASE.RESULT;
  el.statSamples.textContent = formatInt(state.display.samples);
  el.statInside.textContent = formatInt(state.display.inside);
  el.statRatio.textContent = `${state.display.ratio.toFixed(snap && state.nDone < 20 ? 1 : 2)}%`;
  el.statEstimate.textContent = formatNum(state.display.estimate, snap ? 3 : 4);
  // Reference / error stay hidden until the end reveal.
  el.statError.textContent = state.revealExact ? formatPct(state.display.errorPct) : "—";
  [el.statSamples, el.statInside, el.statRatio, el.statEstimate].forEach((node) => {
    node.classList.toggle("is-live", live);
  });
  el.statError.classList.toggle("is-live", state.revealExact);

  updateMeter(dt);
}

function updateMeter(dt = 0.016) {
  const ref = state.data?.integralRef;
  const est = state.display.estimate;
  const area = boxArea();
  if (!Number.isFinite(est) || state.nDone <= 0) {
    el.meterDot.classList.remove("is-on");
    el.meterExact.classList.remove("is-on");
    return;
  }

  // Before the reveal, center the meter on the estimate so the student
  // cannot reverse-engineer the reference from the scale.
  let lo;
  let hi;
  if (state.revealExact && Number.isFinite(ref)) {
    const span = Math.max(Math.abs(ref) * 0.55, Math.abs(est - ref) * 2.2, area * 0.08, 0.35);
    lo = Math.min(ref, est) - span * 0.35;
    hi = Math.max(ref, est) + span * 0.35;
  } else {
    const span = Math.max(area * 0.35, Math.abs(est) * 0.45, 0.5);
    lo = est - span;
    hi = est + span;
    if (lo < 0 && area > 0) {
      hi += -lo;
      lo = 0;
    }
  }

  const tEst = clamp((est - lo) / Math.max(hi - lo, 1e-9), 0.02, 0.98);
  el.meterDot.style.left = `${tEst * 100}%`;
  el.meterDot.classList.add("is-on");
  el.meterLo.textContent = formatNum(lo, 2);
  el.meterHi.textContent = formatNum(hi, 2);
  el.meterMid.textContent = formatNum(est, 3);

  if (state.revealExact && Number.isFinite(ref)) {
    state.exactFade = clamp(state.exactFade + dt / 0.55, 0, 1);
    const tRef = clamp((ref - lo) / Math.max(hi - lo, 1e-9), 0.02, 0.98);
    el.meterExact.style.left = `${tRef * 100}%`;
    el.meterExact.style.opacity = String(state.exactFade);
    el.meterExact.classList.add("is-on");
  } else {
    state.exactFade = 0;
    el.meterExact.style.opacity = "0";
    el.meterExact.classList.remove("is-on");
  }
}

function samplesPerFrame() {
  const profile = SPEED_PROFILE[state.speed] || SPEED_PROFILE.normal;
  if (state.phase === PHASE.SAMPLING_SLOW) return 1;
  if (state.phase === PHASE.SAMPLING_ACCELERATING) {
    const t = clamp((state.nDone - SLOW_COUNT) / Math.max(1, ACCEL_COUNT - SLOW_COUNT), 0, 1);
    return Math.max(1, Math.round(lerp(profile[0], profile[1], t)));
  }
  // SAMPLING_FAST
  const p = state.nDone / Math.max(1, state.nTarget);
  if (p < 0.55) return profile[1];
  if (p < 0.8) return profile[2];
  return profile[3];
}

function allocBuffers(n) {
  state.pointsX = new Float32Array(n);
  state.pointsY = new Float32Array(n);
  state.pointsIn = new Uint8Array(n);
  state.nDone = 0;
  state.nInside = 0;
  state.falling = [];
  state.errorHistory = [];
}

function spawnPoint() {
  if (!state.rng || !state.data?.box) return null;
  const box = state.data.box;
  const x = lerp(box.x0, box.x1, state.rng());
  const y = lerp(box.y0, box.y1, state.rng());
  const fx = evalCurve(x);
  const inside = fx != null && y >= 0 && y <= fx;
  return { x, y, inside, life: 0, land: false };
}

function commitPoint(pt) {
  const i = state.nDone;
  if (i >= state.nTarget) return;
  state.pointsX[i] = pt.x;
  state.pointsY[i] = pt.y;
  state.pointsIn[i] = pt.inside ? 1 : 0;
  state.nDone = i + 1;
  if (pt.inside) state.nInside += 1;
  if (
    state.nDone <= 40
    || state.nDone % 8 === 0
    || state.nDone >= state.nTarget
  ) {
    state.errorHistory.push({
      n: state.nDone,
      err: currentErrorPct(),
      est: currentEstimate(),
    });
  }
}

function advanceSampling(dt) {
  if (state.phase === PHASE.SAMPLING_SLOW) {
    state.slowGap = Math.max(0, state.slowGap - dt);
    const inFlight = state.falling.some((p) => !p.land);
    if (!inFlight && state.slowGap <= 0 && state.nDone < SLOW_COUNT) {
      const pt = spawnPoint();
      if (pt) {
        pt.yStart = state.data.box.y1 + (state.data.box.y1 - state.data.box.y0) * 0.28;
        pt.fallY = pt.yStart;
        // Slow, readable falls for the opening beat.
        pt.duration = 0.72 + state.rng() * 0.28;
        pt.pulse = 0;
        state.falling.push(pt);
      }
    }
  } else {
    const budget = samplesPerFrame();
    let made = 0;
    while (made < budget && state.nDone < state.nTarget) {
      const pt = spawnPoint();
      if (!pt) break;
      commitPoint(pt);
      made += 1;
    }
  }

  const next = [];
  for (const pt of state.falling) {
    if (!pt.land) {
      pt.life += dt;
      const u = clamp(pt.life / pt.duration, 0, 1);
      pt.fallY = lerp(pt.yStart, pt.y, easeOutCubic(u));
      if (u >= 1) {
        pt.land = true;
        pt.pulse = 0.32;
        commitPoint(pt);
        // Beat between dramatic first samples.
        if (state.phase === PHASE.SAMPLING_SLOW) {
          state.slowGap = 0.28 + state.rng() * 0.12;
        }
      }
      next.push(pt);
      continue;
    }
    pt.pulse -= dt;
    if (pt.pulse > 0) next.push(pt);
  }
  state.falling = next;

  if (state.phase === PHASE.SAMPLING_SLOW && state.nDone >= SLOW_COUNT && !state.falling.some((p) => !p.land)) {
    setPhase(PHASE.SAMPLING_ACCELERATING);
    setStatus("sampling accelerating…");
  } else if (state.phase === PHASE.SAMPLING_ACCELERATING && state.nDone >= ACCEL_COUNT) {
    setPhase(PHASE.SAMPLING_FAST);
    setStatus("sampling rapidly…");
  }
}

function drawRegionShade(ctx, alpha) {
  if (alpha <= 0.001 || !state.data?.curveX) return;
  const xs = state.data.curveX;
  const ys = state.data.curveY;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = "rgba(124, 156, 255, 0.28)";
  ctx.beginPath();
  let started = false;
  for (let i = 0; i < xs.length; i += 1) {
    const y = ys[i];
    if (y == null || y < 0) {
      started = false;
      continue;
    }
    const [sx, sy] = viewer.worldToScreen(xs[i], y);
    if (!started) {
      const [bx, by] = viewer.worldToScreen(xs[i], 0);
      ctx.moveTo(bx, by);
      ctx.lineTo(sx, sy);
      started = true;
    } else {
      ctx.lineTo(sx, sy);
    }
  }
  if (started) {
    const last = xs.length - 1;
    const [ex, ey] = viewer.worldToScreen(xs[last], 0);
    ctx.lineTo(ex, ey);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function drawRectangle(ctx, edges) {
  const box = state.data?.box;
  if (!box || edges <= 0) return;
  const dpr = window.devicePixelRatio || 1;
  const [x0, y0] = viewer.worldToScreen(box.x0, box.y0);
  const [x1, y1] = viewer.worldToScreen(box.x1, box.y1);
  const left = Math.min(x0, x1);
  const right = Math.max(x0, x1);
  const top = Math.min(y0, y1);
  const bottom = Math.max(y0, y1);
  const w = right - left;
  const h = bottom - top;

  ctx.save();
  ctx.strokeStyle = "rgba(183, 197, 255, 0.42)";
  ctx.lineWidth = 1.15 * dpr;
  ctx.setLineDash([4 * dpr, 4 * dpr]);
  ctx.beginPath();
  // edges: 0..1 constructs left, bottom, right, top in sequence
  const e = edges * 4;
  if (e > 0) {
    const t = clamp(e, 0, 1);
    ctx.moveTo(left, top);
    ctx.lineTo(left, top + h * t);
  }
  if (e > 1) {
    const t = clamp(e - 1, 0, 1);
    ctx.moveTo(left, bottom);
    ctx.lineTo(left + w * t, bottom);
  }
  if (e > 2) {
    const t = clamp(e - 2, 0, 1);
    ctx.moveTo(right, bottom);
    ctx.lineTo(right, bottom - h * t);
  }
  if (e > 3) {
    const t = clamp(e - 3, 0, 1);
    ctx.moveTo(right, top);
    ctx.lineTo(right - w * t, top);
  }
  ctx.stroke();
  ctx.restore();
}

function drawBoundMarkers(ctx, pulse) {
  if (!state.data?.interval) return;
  const [a, b] = state.data.interval;
  const dpr = window.devicePixelRatio || 1;
  const glow = 0.35 + pulse * 0.45;
  ctx.save();
  for (const x of [a, b]) {
    const [sx] = viewer.worldToScreen(x, 0);
    ctx.strokeStyle = `rgba(245, 200, 66, ${glow})`;
    ctx.lineWidth = (1.4 + pulse * 1.2) * dpr;
    ctx.beginPath();
    ctx.moveTo(sx, 0);
    ctx.lineTo(sx, viewer.canvas.height);
    ctx.stroke();
  }
  ctx.restore();
}

function drawPoints(ctx) {
  if (!state.pointsX || state.nDone <= 0) return;
  const dpr = window.devicePixelRatio || 1;
  const n = state.nDone;
  // Subsample for draw when very dense.
  const step = n > 12000 ? 3 : n > 6000 ? 2 : 1;
  ctx.save();
  for (let pass = 0; pass < 2; pass += 1) {
    const insidePass = pass === 0;
    ctx.fillStyle = insidePass
      ? "rgba(125, 240, 205, 0.72)"
      : "rgba(150, 164, 198, 0.38)";
    const size = (insidePass ? 2.1 : 1.7) * dpr;
    for (let i = 0; i < n; i += step) {
      if (Boolean(state.pointsIn[i]) !== insidePass) continue;
      const [sx, sy] = viewer.worldToScreen(state.pointsX[i], state.pointsY[i]);
      ctx.fillRect(sx - size * 0.5, sy - size * 0.5, size, size);
    }
  }
  ctx.restore();
}

function drawFalling(ctx) {
  const dpr = window.devicePixelRatio || 1;
  for (const pt of state.falling) {
    const y = pt.land ? pt.y : pt.fallY;
    const [sx, sy] = viewer.worldToScreen(pt.x, y);
    const pulse = pt.land ? Math.max(0, pt.pulse) : 0;
    const r = (2.2 + pulse * 6) * dpr;
    ctx.save();
    ctx.fillStyle = pt.inside
      ? `rgba(125, 240, 205, ${0.55 + pulse})`
      : `rgba(190, 200, 220, ${0.4 + pulse * 0.4})`;
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.fill();
    if (!pt.land) {
      ctx.strokeStyle = "rgba(183, 197, 255, 0.25)";
      ctx.lineWidth = 1 * dpr;
      ctx.beginPath();
      const [tx, ty] = viewer.worldToScreen(pt.x, pt.yStart);
      ctx.moveTo(tx, ty);
      ctx.lineTo(sx, sy);
      ctx.stroke();
    }
    ctx.restore();
  }
}

function drawScene() {
  if (!viewer) return;
  viewer.setupCanvasResolution();
  viewer.drawGrid();
  if (!state.data?.yTrue) return;

  drawBoundMarkers(viewer.ctx, state.boundPulse);
  drawRectangle(viewer.ctx, state.rectEdges);
  drawRegionShade(viewer.ctx, state.shadeAlpha);
  drawPoints(viewer.ctx);
  drawFalling(viewer.ctx);

  viewer.drawLine(state.data.x, state.data.yTrue, "#2ee8bb", 2.55, 0.92);
  viewer.notifyView?.();
}

function drawConvergence(progress) {
  const canvas = el.convCanvas;
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 280;
  const cssH = 118;
  canvas.width = Math.floor(cssW * dpr);
  canvas.height = Math.floor(cssH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  ctx.fillStyle = "rgba(12, 18, 36, 0.2)";
  ctx.fillRect(0, 0, cssW, cssH);

  const hist = state.errorHistory;
  if (hist.length < 2) return;
  const padL = 10;
  const padR = 10;
  const padT = 18;
  const padB = 22;
  const plotW = cssW - padL - padR;
  const plotH = cssH - padT - padB;
  const maxErr = Math.max(...hist.map((h) => h.err), 1e-6);
  const maxN = Math.max(hist[hist.length - 1].n, 2);
  const minN = Math.max(1, hist[0].n);
  const count = Math.max(2, Math.floor(hist.length * clamp(progress, 0, 1)));

  const xOf = (n) => {
    const lo = Math.log10(minN);
    const hi = Math.log10(maxN);
    const t = (Math.log10(Math.max(n, minN)) - lo) / Math.max(hi - lo, 1e-9);
    return padL + clamp(t, 0, 1) * plotW;
  };
  const yOf = (err) => padT + (1 - err / maxErr) * plotH;

  // Faint O(1/√N) reference (scaled to first error sample).
  const e0 = hist[0].err;
  const n0 = hist[0].n;
  ctx.beginPath();
  ctx.strokeStyle = "rgba(159, 182, 255, 0.28)";
  ctx.setLineDash([3, 4]);
  ctx.lineWidth = 1;
  let first = true;
  for (let i = 0; i < count; i += 1) {
    const n = hist[i].n;
    const ref = e0 * Math.sqrt(n0 / Math.max(n, 1));
    const x = xOf(n);
    const y = yOf(Math.min(ref, maxErr));
    if (first) {
      ctx.moveTo(x, y);
      first = false;
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.beginPath();
  ctx.strokeStyle = "rgba(245, 200, 66, 0.9)";
  ctx.lineWidth = 1.7;
  for (let i = 0; i < count; i += 1) {
    const h = hist[i];
    const x = xOf(h.n);
    const y = yOf(h.err);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  ctx.strokeStyle = "rgba(90, 109, 161, 0.45)";
  ctx.lineWidth = 1;
  ctx.strokeRect(padL, padT, plotW, plotH);

  ctx.fillStyle = "rgba(198, 212, 255, 0.72)";
  ctx.font = "10px ui-monospace, SF Mono, Menlo, monospace";
  ctx.fillText("Error vs samples", padL + 2, 12);

  // Sample-count milestones along a log axis.
  const marks = [100, 1000, 10000, 50000].filter((n) => n >= minN && n <= maxN * 1.05);
  ctx.fillStyle = "rgba(150, 164, 198, 0.85)";
  ctx.font = "9px ui-monospace, SF Mono, Menlo, monospace";
  ctx.textAlign = "center";
  marks.forEach((n) => {
    const x = xOf(n);
    ctx.strokeStyle = "rgba(90, 109, 161, 0.35)";
    ctx.beginPath();
    ctx.moveTo(x, padT + plotH);
    ctx.lineTo(x, padT + plotH + 4);
    ctx.stroke();
    const label = n >= 1000 ? `${n / 1000}k` : String(n);
    ctx.fillText(label, x, cssH - 6);
  });
  ctx.textAlign = "left";
}

function applyFormulaBeat(beat) {
  if (!state.data) return;
  if (beat === 0) {
    LatexDisplay.setImage(el.latexImage, state.data.latexPng);
  } else if (beat === 1) {
    LatexDisplay.setImage(el.latexImage, state.data.latexPngBox || state.data.latexPng);
  } else {
    LatexDisplay.setImage(el.latexImage, state.data.latexPngFull || state.data.latexPng);
  }
  state.formulaBeat = beat;
}

function updatePhaseLabel(now) {
  if (state.phaseLabelUntil > now) {
    el.phaseLabel.hidden = false;
  } else {
    el.phaseLabel.hidden = true;
  }
}

function stopLoop() {
  state.animating = false;
  state.paused = false;
  state.lastTs = 0;
  if (state.rafId) cancelAnimationFrame(state.rafId);
  state.rafId = null;
  el.pauseBtn.textContent = "Pause";
}

function finishToResult() {
  setPhase(PHASE.RESULT);
  state.revealExact = true;
  state.animating = false;
  el.finalPanel.hidden = false;
  el.finalEstimate.textContent = formatNum(currentEstimate(), 4);
  el.finalRef.textContent = formatNum(state.data.integralRef, 4);
  el.finalError.textContent = formatPct(currentErrorPct());
  el.finalPanel.classList.add("is-emphasize");
  setTimeout(() => el.finalPanel.classList.remove("is-emphasize"), 900);
  setStatus("experiment complete. same inputs + seed replay identically.");
  updateStatsUI(1);
  drawScene();
}

function frame(ts) {
  if (!state.animating) return;
  if (state.paused) {
    state.lastTs = ts;
    state.rafId = requestAnimationFrame(frame);
    return;
  }
  const dt = state.lastTs ? clamp((ts - state.lastTs) / 1000, 0, 0.05) : 0.016;
  state.lastTs = ts;
  state.phaseT += dt;

  if (state.phase === PHASE.SETUP) {
    const t = state.phaseT;
    state.boundPulse = t < 0.45 ? Math.sin((t / 0.45) * Math.PI) : 0.15;
    state.rectEdges = clamp((t - 0.28) / 0.55, 0, 1);
    state.shadeAlpha = clamp((t - 0.72) / 0.35, 0, 1) * 0.16;
    // Construct the formula: Area ≈ … → A_box = … → both.
    if (t >= 0.35 && state.formulaBeat < 1) applyFormulaBeat(1);
    if (t >= 0.95 && state.formulaBeat < 2) applyFormulaBeat(2);
    if (t >= 1.15 && t < 1.45) {
      el.phaseLabel.textContent = "Random samples";
      state.phaseLabelUntil = performance.now() + 480;
    }
    if (t >= 1.55) {
      setPhase(PHASE.SAMPLING_SLOW);
      state.boundPulse = 0.12;
      state.slowGap = 0.15;
      setStatus("first samples…");
    }
  } else if (isSamplingPhase()) {
    advanceSampling(dt);
    setStatus(`sampling ${formatInt(state.nDone)} / ${formatInt(state.nTarget)}`);
    if (state.nDone >= state.nTarget && state.falling.length === 0) {
      setPhase(PHASE.FINAL_PAUSE);
      setStatus("settling…");
    }
  } else if (state.phase === PHASE.FINAL_PAUSE) {
    // Exact stays hidden through the pause — reveal is the next beat.
    if (state.phaseT >= 0.7) {
      setPhase(PHASE.CONVERGENCE);
      state.revealExact = true;
      state.exactFade = 0;
      state.convProgress = 0;
      el.convCanvas.hidden = false;
      setStatus("drawing convergence…");
    }
  } else if (state.phase === PHASE.CONVERGENCE) {
    state.convProgress = clamp(state.phaseT / 1.15, 0, 1);
    drawConvergence(state.convProgress);
    if (state.convProgress >= 1) {
      finishToResult();
      updatePhaseLabel(performance.now());
      return;
    }
  }

  updateStatsUI(dt);
  updatePhaseLabel(performance.now());
  drawScene();
  state.rafId = requestAnimationFrame(frame);
}

async function prepareExperiment() {
  const payload = payloadFromInputs();
  if (!payload.expr) {
    setStatus("Please enter a function.");
    return false;
  }
  setStatus("preparing experiment…");
  const result = await window.pywebview.api.compute_monte_carlo(payload);
  if (!result?.ok) {
    setStatus(`error: ${result?.error || "could not compute."}`);
    return false;
  }
  const seed = Number(el.seedInput.value);
  state.seed = Number.isFinite(seed) ? (seed >>> 0) : 184729;
  el.seedInput.value = String(state.seed);

  state.data = result;
  state.nTarget = result.n || Number(el.nInput.value) || 10000;
  state.experiment = {
    expr: result.expr || payload.expr,
    a: result.interval[0],
    b: result.interval[1],
    n: state.nTarget,
    seed: state.seed,
  };
  state.rng = mulberry32(state.seed);
  allocBuffers(state.nTarget);
  state.revealExact = false;
  state.exactFade = 0;
  state.boundPulse = 0;
  state.rectEdges = 0;
  state.shadeAlpha = 0;
  state.phaseT = 0;
  state.convProgress = 0;
  state.slowGap = 0;
  state.formulaBeat = 0;
  resetStatsDisplay(true);
  syncExperimentPanel();
  applyFormulaBeat(0);
  viewer.setData(result, payload, { preserveView: false });
  drawScene();
  return true;
}

async function runAnimation() {
  stopLoop();
  const ok = await prepareExperiment();
  if (!ok) return;
  setPhase(PHASE.SETUP);
  state.animating = true;
  state.paused = false;
  state.lastTs = 0;
  el.pauseBtn.textContent = "Pause";
  setStatus("establishing the sampling region…");
  state.rafId = requestAnimationFrame(frame);
}

function clearSampleCloud() {
  state.nDone = 0;
  state.nInside = 0;
  state.pointsX = null;
  state.pointsY = null;
  state.pointsIn = null;
  state.falling = [];
  state.errorHistory = [];
  state.convProgress = 0;
  state.exactFade = 0;
  el.convCanvas.hidden = true;
  el.finalPanel.hidden = true;
}

function softReset() {
  stopLoop();
  setPhase(PHASE.IDLE);
  clearSampleCloud();
  state.boundPulse = 0;
  state.rectEdges = 0;
  state.shadeAlpha = 0;
  state.revealExact = false;
  state.phaseLabelUntil = 0;
  el.phaseLabel.hidden = true;
  resetStatsDisplay(true);
  if (state.data) {
    drawScene();
    setStatus("reset. press Animate to run the experiment.");
  } else {
    viewer?.drawGrid();
    setStatus("ready.");
  }
}

function wireInteractions() {
  el.homeBtn?.addEventListener("click", async () => {
    stopLoop();
    if (typeof window.pywebview.api.go_home === "function") {
      await VizTransition.navigateWithWoosh(VizTransition.back, () => (
        window.pywebview.api.go_home()
      ));
    }
  });

  el.animateBtn.addEventListener("click", () => runAnimation());
  el.pauseBtn.addEventListener("click", () => {
    if (!state.animating) {
      setStatus("nothing to pause. press Animate first.");
      return;
    }
    state.paused = !state.paused;
    el.pauseBtn.textContent = state.paused ? "Resume" : "Pause";
    setStatus(state.paused ? "paused." : "resumed.");
  });
  el.resetBtn.addEventListener("click", () => softReset());

  el.nInput.addEventListener("input", () => {
    el.nValue.textContent = formatInt(Number(el.nInput.value));
  });

  el.seedRandomBtn.addEventListener("click", () => {
    el.seedInput.value = String((Math.random() * 1e9) | 0);
  });

  document.querySelectorAll(".mc-speed-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".mc-speed-btn").forEach((b) => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      state.speed = btn.dataset.speed || "normal";
    });
  });

  FunctionPreview.wire({
    viewer,
    exprInput: el.exprInput,
    extraInputs: [el.aInput, el.bInput, el.xminInput, el.xmaxInput],
    getPayload: payloadFromInputs,
    previewApi: (payload) => window.pywebview.api.preview_monte_carlo(payload),
    onBeforePlot: () => {
      if (state.animating) stopLoop();
      setPhase(PHASE.IDLE);
      clearSampleCloud();
      state.rectEdges = 0;
      state.shadeAlpha = 0;
      state.boundPulse = 0;
      state.revealExact = false;
      resetStatsDisplay(true);
    },
    onPlotted: () => {
      state.data = viewer.data;
      // Preview responses lack the sampling envelope; keep cloud cleared.
      clearSampleCloud();
      LatexDisplay.fromData(el.latexImage, viewer.data);
      FunctionPreview.drawFunctionOnly(viewer);
      setStatus("f(x) plotted. press Animate to sample.");
    },
    onError: (err) => setStatus(`error: ${err}`),
  });
}

async function bootstrap() {
  VizTransition.initPageTransition();
  el.homeBtn = $("homeBtn");
  el.exprInput = $("exprInput");
  el.aInput = $("aInput");
  el.bInput = $("bInput");
  el.nInput = $("nInput");
  el.nValue = $("nValue");
  el.seedInput = $("seedInput");
  el.seedRandomBtn = $("seedRandomBtn");
  el.xminInput = $("xminInput");
  el.xmaxInput = $("xmaxInput");
  el.animateBtn = $("animateBtn");
  el.pauseBtn = $("pauseBtn");
  el.resetBtn = $("resetBtn");
  el.status = $("status");
  el.latexImage = $("latexImage");
  el.statSamples = $("statSamples");
  el.statInside = $("statInside");
  el.statRatio = $("statRatio");
  el.statEstimate = $("statEstimate");
  el.statError = $("statError");
  el.meterDot = $("meterDot");
  el.meterExact = $("meterExact");
  el.meterLo = $("meterLo");
  el.meterHi = $("meterHi");
  el.meterMid = $("meterMid");
  el.convCanvas = $("convCanvas");
  el.finalPanel = $("finalPanel");
  el.finalEstimate = $("finalEstimate");
  el.finalRef = $("finalRef");
  el.finalError = $("finalError");
  el.phaseLabel = $("phaseLabel");
  el.expExpr = $("expExpr");
  el.expBounds = $("expBounds");
  el.expN = $("expN");
  el.expSeed = $("expSeed");

  viewer = new GraphViewer($("plotCanvas"));
  viewer.setRedrawHandler(() => {
    if (state.phase === PHASE.IDLE && state.data?.yTrue && state.nDone === 0) {
      FunctionPreview.drawFunctionOnly(viewer);
      return;
    }
    drawScene();
  });

  wireInteractions();

  let boot;
  try {
    boot = await window.pywebview.api.get_monte_carlo_bootstrap();
  } catch (err) {
    setStatus(String(err));
    return;
  }

  const hints = $("functionHints");
  (boot?.hints || []).forEach((h) => {
    const op = document.createElement("option");
    op.value = h;
    hints.appendChild(op);
  });

  const presets = $("presets");
  (boot?.presets || []).forEach(([label, expr, a, b]) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "preset-btn";
    btn.textContent = label;
    btn.addEventListener("click", () => {
      softReset();
      el.exprInput.value = expr;
      el.aInput.value = String(a);
      el.bInput.value = String(b);
      el.xminInput.value = String(Number(a) - 0.5);
      el.xmaxInput.value = String(Number(b) + 0.5);
      el.exprInput.dispatchEvent(new Event("input", { bubbles: true }));
      setStatus(`preset: ${label}`);
    });
    presets.appendChild(btn);
  });

  if (boot?.nDefault) {
    el.nInput.value = String(boot.nDefault);
    el.nValue.textContent = formatInt(boot.nDefault);
  }
  if (boot?.nMin != null) el.nInput.min = String(boot.nMin);
  if (boot?.nMax != null) el.nInput.max = String(boot.nMax);

  LatexDisplay.setImage(el.latexImage, boot?.latexPng);
  resetStatsDisplay(true);
  el.exprInput.dispatchEvent(new Event("input", { bubbles: true }));
}

whenApiReady(bootstrap);
