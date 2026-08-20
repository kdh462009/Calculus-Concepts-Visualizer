const DEFAULT_ZOOM = 1.4;

const state = {
  data: null,
  animating: false,
  paused: false,
  rafId: null,
  lastTs: 0,
  elapsed: 0,
  sweepAngle: 0,
  camYaw: 0,
  camPitch: 0,
  viewOffsetX: 0,
  viewOffsetY: 0,
  zoom: DEFAULT_ZOOM,
  viewLocked: false,
};

const el = {};
let renderer;

function $(id) {
  return document.getElementById(id);
}

function setStatus(text) {
  el.status.textContent = text;
}

function snapVolumeView() {
  state.viewOffsetX = 0;
  state.viewOffsetY = 0;
  state.zoom = DEFAULT_ZOOM;
  state.camYaw = 0;
  state.camPitch = 0;
}

function syncViewLockChrome() {
  renderer?.viewSnap?.sync();
  renderer?.scaleBar?.root?.classList.toggle("is-view-locked", state.viewLocked);
}

function lockVolumeView() {
  snapVolumeView();
  state.viewLocked = true;
  syncViewLockChrome();
  drawCurrentFrame();
}

function unlockVolumeView() {
  state.viewLocked = false;
  syncViewLockChrome();
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function easeOutCubic(t) {
  return 1 - (1 - t) ** 3;
}

class VolumeRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.dpr = Math.max(window.devicePixelRatio || 1, 1);
    this.w = 0;
    this.h = 0;
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.w = Math.max(300, Math.floor(rect.width));
    this.h = Math.max(220, Math.floor(rect.height));
    this.canvas.width = Math.floor(this.w * this.dpr);
    this.canvas.height = Math.floor(this.h * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    // Keep the model locked to center when the window/layout changes.
    state.viewOffsetX = 0;
    state.viewOffsetY = 0;
    this.draw(
      state.data,
      state.sweepAngle,
      state.camYaw,
      state.camPitch,
      state.viewOffsetX,
      state.viewOffsetY,
      state.zoom,
    );
  }

  rotatePoint(px, py, pz, yaw, pitch) {
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    const cx = Math.cos(pitch);
    const sx = Math.sin(pitch);

    const x1 = px * cy + pz * sy;
    const z1 = -px * sy + pz * cy;

    const y2 = py * cx - z1 * sx;
    const z2 = py * sx + z1 * cx;
    return { x: x1, y: y2, z: z2 };
  }

  project(point, scale, yaw, pitch) {
    const r = this.rotatePoint(point.x, point.y, point.z, yaw, pitch);
    const perspective = 700 / (700 + r.z + 340);
    return {
      x: this.w * 0.5 + this.offsetX + r.x * scale * perspective,
      y: this.h * 0.5 + this.offsetY - r.y * scale * perspective,
      z: r.z,
    };
  }

  buildProfile(data) {
    const out = [];
    for (let i = 0; i < data.xBound.length; i += 1) {
      const x = data.xBound[i];
      const y = data.yBound[i];
      if (x === null || y === null || !Number.isFinite(x) || !Number.isFinite(y)) continue;
      out.push({ x, y });
    }
    return out;
  }

  surfacePoint(axis, x, y, theta) {
    if (axis === "x") {
      return { x, y: y * Math.cos(theta), z: y * Math.sin(theta) };
    }
    return { x: x * Math.cos(theta), y, z: x * Math.sin(theta) };
  }

  drawAxes(scale, yaw, pitch, data) {
    const ctx = this.ctx;
    const hints = data.scaleHints || {};
    const axisLenX = Math.max(Math.abs(data.xRange[0]), Math.abs(data.xRange[1]), hints.maxAbsX || 1) * 1.2;
    const axisLenY = Math.max(hints.maxAbsY || 1, 1) * 1.25;
    const axisLenZ = Math.max(hints.maxAbsY || hints.maxAbsX || 1, 1) * 1.25;

    const drawAxis = (from, to, color, label) => {
      const p0 = this.project(from, scale, yaw, pitch);
      const p1 = this.project(to, scale, yaw, pitch);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.font = "13px -apple-system, BlinkMacSystemFont, sans-serif";
      ctx.fillText(label, p1.x + 4, p1.y - 3);
    };

    drawAxis({ x: -axisLenX, y: 0, z: 0 }, { x: axisLenX, y: 0, z: 0 }, "#6fb8ff", "x");
    drawAxis({ x: 0, y: -axisLenY, z: 0 }, { x: 0, y: axisLenY, z: 0 }, "#8ef6c7", "y");
    drawAxis({ x: 0, y: 0, z: -axisLenZ }, { x: 0, y: 0, z: axisLenZ }, "#d7a8ff", "z");
  }

  drawCurve2D(data, scale, yaw, pitch) {
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
      const p = this.project({ x, y, z: 0 }, scale, yaw, pitch);
      if (!started) {
        ctx.moveTo(p.x, p.y);
        started = true;
      } else {
        ctx.lineTo(p.x, p.y);
      }
    }
    ctx.stroke();
  }

  drawAreaGuide(data, profile, scale, yaw, pitch) {
    const ctx = this.ctx;
    if (!profile.length) return;

    const axis = data.axis === "y" ? "y" : "x";
    const maxY = 1.02 * (data.scaleHints.maxAbsY || 1);

    ctx.beginPath();
    const p0 = this.project({ x: profile[0].x, y: 0, z: 0 }, scale, yaw, pitch);
    ctx.moveTo(p0.x, p0.y);
    for (let i = 0; i < profile.length; i += 1) {
      const p = this.project({ x: profile[i].x, y: profile[i].y, z: 0 }, scale, yaw, pitch);
      ctx.lineTo(p.x, p.y);
    }
    const pN = this.project({ x: profile[profile.length - 1].x, y: 0, z: 0 }, scale, yaw, pitch);
    ctx.lineTo(pN.x, pN.y);
    ctx.closePath();
    ctx.fillStyle = "rgba(245, 200, 66, 0.18)";
    ctx.fill();
    ctx.strokeStyle = "rgba(245, 200, 66, 0.8)";
    ctx.lineWidth = 1.1;
    ctx.stroke();

    const a = data.bounds[0];
    const b = data.bounds[1];
    const pa0 = this.project({ x: a, y: 0, z: 0 }, scale, yaw, pitch);
    const pa1 = this.project({ x: a, y: maxY, z: 0 }, scale, yaw, pitch);
    const pb0 = this.project({ x: b, y: 0, z: 0 }, scale, yaw, pitch);
    const pb1 = this.project({ x: b, y: maxY, z: 0 }, scale, yaw, pitch);
    ctx.strokeStyle = "rgba(245, 200, 66, 0.6)";
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(pa0.x, pa0.y);
    ctx.lineTo(pa1.x, pa1.y);
    ctx.moveTo(pb0.x, pb0.y);
    ctx.lineTo(pb1.x, pb1.y);
    ctx.stroke();
    ctx.setLineDash([]);

    const rotColor = axis === "x" ? "#6fb8ff" : "#8ef6c7";
    const rotLabel = axis === "x" ? "rotation axis (x)" : "rotation axis (y)";
    const rotFrom =
      axis === "x"
        ? { x: Math.min(a, b) - 0.2, y: 0, z: 0 }
        : { x: 0, y: 0, z: 0 };
    const rotTo =
      axis === "x"
        ? { x: Math.max(a, b) + 0.2, y: 0, z: 0 }
        : { x: 0, y: maxY, z: 0 };
    const rp0 = this.project(rotFrom, scale, yaw, pitch);
    const rp1 = this.project(rotTo, scale, yaw, pitch);
    ctx.strokeStyle = rotColor;
    ctx.lineWidth = 2.4;
    ctx.setLineDash([8, 5]);
    ctx.beginPath();
    ctx.moveTo(rp0.x, rp0.y);
    ctx.lineTo(rp1.x, rp1.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = rotColor;
    ctx.font = "12px -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.fillText(rotLabel, rp1.x + 6, rp1.y - 4);
  }

  drawSurface(data, profile, maxTheta, scale, yaw, pitch) {
    const ctx = this.ctx;
    if (!profile.length) return;

    const thetaStep = Math.PI / 28;
    const maxStep = Math.max(1, Math.floor(maxTheta / thetaStep));
    const xStride = Math.max(1, Math.floor(profile.length / 45));

    ctx.strokeStyle = "rgba(143, 127, 255, 0.72)";
    ctx.lineWidth = 1.0;

    for (let t = 0; t <= maxStep; t += 1) {
      const theta = Math.min(maxTheta, t * thetaStep);
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < profile.length; i += xStride) {
        const pt = profile[Math.min(profile.length - 1, i)];
        const sp = this.surfacePoint(data.axis, pt.x, pt.y, theta);
        const p = this.project(sp, scale, yaw, pitch);
        if (!started) {
          ctx.moveTo(p.x, p.y);
          started = true;
        } else {
          ctx.lineTo(p.x, p.y);
        }
      }
      ctx.stroke();
    }

    ctx.strokeStyle = "rgba(240, 96, 144, 0.58)";
    for (let i = 0; i < profile.length; i += xStride) {
      ctx.beginPath();
      let started = false;
      for (let t = 0; t <= maxStep; t += 1) {
        const theta = Math.min(maxTheta, t * thetaStep);
        const pt = profile[i];
        const sp = this.surfacePoint(data.axis, pt.x, pt.y, theta);
        const p = this.project(sp, scale, yaw, pitch);
        if (!started) {
          ctx.moveTo(p.x, p.y);
          started = true;
        } else {
          ctx.lineTo(p.x, p.y);
        }
      }
      ctx.stroke();
    }
  }

  draw(data, sweepAngle, yaw, pitch, offsetX, offsetY, zoom) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.w, this.h);
    ctx.fillStyle = "rgba(10, 16, 32, 0.96)";
    ctx.fillRect(0, 0, this.w, this.h);
    this.offsetX = offsetX || 0;
    this.offsetY = offsetY || 0;

    if (!data) {
      ctx.fillStyle = "#94a3d9";
      ctx.font = "15px -apple-system, BlinkMacSystemFont, sans-serif";
      ctx.fillText("Press Animate to compute and animate.", 20, 34);
      this.scaleBar?.sync();
      return;
    }

    const hints = data.scaleHints || {};
    const worldX = Math.max(Math.abs(data.xRange[0]), Math.abs(data.xRange[1]), hints.maxAbsX || 1);
    const worldY = Math.max(hints.maxAbsY || 1, 1);
    const worldZ = Math.max(worldY, worldX * 0.9, 1);
    const worldSize = Math.max(worldX, worldY, worldZ);
    const scale = Math.min(this.w, this.h) * 0.36 * Math.max(0.45, Math.min(2.2, zoom || 1)) / Math.max(worldSize, 1);

    const profile = this.buildProfile(data);
    this.drawAxes(scale, yaw, pitch, data);
    this.drawAreaGuide(data, profile, scale, yaw, pitch);
    this.drawCurve2D(data, scale, yaw, pitch);
    this.drawSurface(data, profile, sweepAngle, scale, yaw, pitch);
    this.scaleBar?.sync();
  }
}

function stopAnimation() {
  state.animating = false;
  state.paused = false;
  state.lastTs = 0;
  if (state.rafId) cancelAnimationFrame(state.rafId);
  state.rafId = null;
  el.pauseBtn.textContent = "Pause";
}

const VOLUME_PERSP = 700 / (700 + 340);

function volumeWorldSize(data) {
  if (!data) return 2;
  const hints = data.scaleHints || {};
  const worldX = Math.max(Math.abs(data.xRange?.[0] || 0), Math.abs(data.xRange?.[1] || 0), hints.maxAbsX || 1);
  const worldY = Math.max(hints.maxAbsY || 1, 1);
  const worldZ = Math.max(worldY, worldX * 0.9, 1);
  return Math.max(worldX, worldY, worldZ, 1);
}

function volumePixelScale() {
  const worldSize = volumeWorldSize(state.data);
  const zoom = Math.max(0.45, Math.min(2.2, state.zoom || 1));
  const w = renderer?.w || 1;
  const h = renderer?.h || 1;
  return Math.min(w, h) * 0.36 * zoom / worldSize;
}

function volumeGetView() {
  const k = Math.max(volumePixelScale() * VOLUME_PERSP, 1e-6);
  const halfW = (renderer?.w || 1) * 0.5 / k;
  const halfH = (renderer?.h || 1) * 0.5 / k;
  const cx = -(state.viewOffsetX || 0) / k;
  const cy = (state.viewOffsetY || 0) / k;
  return {
    xmin: cx - halfW,
    xmax: cx + halfW,
    ymin: cy - halfH,
    ymax: cy + halfH,
  };
}

function volumeSetView(view) {
  if (state.viewLocked) {
    state.viewLocked = false;
    syncViewLockChrome();
  }
  const spanX = Math.max(view.xmax - view.xmin, 0.5);
  const spanY = Math.max(view.ymax - view.ymin, 0.5);
  const w = renderer?.w || 1;
  const h = renderer?.h || 1;
  const scaleFromX = w / (spanX * VOLUME_PERSP);
  const scaleFromY = h / (spanY * VOLUME_PERSP);
  const scale = Math.min(scaleFromX, scaleFromY);
  const worldSize = volumeWorldSize(state.data);
  state.zoom = Math.max(0.45, Math.min(2.2, scale * worldSize / (Math.min(w, h) * 0.36)));
  const k = volumePixelScale() * VOLUME_PERSP;
  const cx = (view.xmin + view.xmax) / 2;
  const cy = (view.ymin + view.ymax) / 2;
  state.viewOffsetX = -cx * k;
  state.viewOffsetY = cy * k;
  drawCurrentFrame();
}

function drawCurrentFrame() {
  renderer.draw(
    state.data,
    state.sweepAngle,
    state.camYaw,
    state.camPitch,
    state.viewOffsetX,
    state.viewOffsetY,
    state.zoom,
  );
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

  const revolutionMs = Number(el.speedInput.value);
  const phase = Math.max(0, Math.min(1, state.elapsed / revolutionMs));
  const eased = easeOutCubic(phase);

  state.sweepAngle = Math.min(Math.PI * 2, Math.PI * 2 * eased);
  state.camPitch = lerp(0, 0.92, eased);
  state.camYaw = lerp(0, 0.7, eased);

  if (phase >= 1) {
    const spin = (state.elapsed - revolutionMs) / 7000;
    state.camYaw = 0.7 + spin * Math.PI * 2;
    state.sweepAngle = Math.PI * 2;
  }

  drawCurrentFrame();
  setStatus(phase < 1 ? "animating sweep to 3D..." : "3D view active; rotating.");
  state.rafId = requestAnimationFrame(loop);
}

function payloadFromInputs() {
  return {
    expr: el.exprInput.value.trim(),
    axis: el.axisInput.value,
    a: Number(el.aInput.value),
    b: Number(el.bInput.value),
    xmin: Number(el.xminInput.value),
    xmax: Number(el.xmaxInput.value),
    samples: 2200,
  };
}

function renderReadouts(data) {
  LatexDisplay.setImage(el.latexImage, data.latexPng);
  LatexDisplay.renderReadout(el.readoutImage, {
    kind: "volume",
    area: data.area,
    volume: data.volume,
    axis: data.axis,
  });
}

let previewTimer = null;

function schedulePreview() {
  if (previewTimer) clearTimeout(previewTimer);
  previewTimer = setTimeout(async () => {
    previewTimer = null;
    if (state.animating) return;
    await computeModel({ preview: true });
  }, 160);
}

async function computeModel(options = {}) {
  const { preview = false } = options;
  const payload = payloadFromInputs();
  if (!payload.expr) {
    setStatus("Please enter a function.");
    return false;
  }
  setStatus("computing area + volume...");
  const result = await window.pywebview.api.compute_volume(payload);
  if (!result.ok) {
    setStatus(`error: ${result.error}`);
    return false;
  }
  state.data = result;
  state.elapsed = 0;
  state.sweepAngle = 0;
  state.camPitch = 0;
  state.camYaw = 0;
  state.viewOffsetX = 0;
  state.viewOffsetY = 0;
  state.zoom = DEFAULT_ZOOM;
  renderReadouts(result);
  drawCurrentFrame();
  const axisLabel = payload.axis === "y" ? "y-axis" : "x-axis";
  if (preview) {
    setStatus(`preview on [${payload.a}, ${payload.b}] around ${axisLabel}. press Animate to sweep.`);
  } else {
    setStatus(`computed on [${payload.a}, ${payload.b}] around ${axisLabel}. drag to move view.`);
  }
  return true;
}

async function startAnimation() {
  stopAnimation();
  const ok = await computeModel();
  if (!ok) return;

  state.animating = true;
  state.paused = false;
  state.lastTs = 0;
  state.elapsed = 0;
  state.sweepAngle = 0;
  state.camPitch = 0;
  state.camYaw = 0;
  state.viewOffsetX = 0;
  state.viewOffsetY = 0;
  state.zoom = DEFAULT_ZOOM;
  setStatus("animating rotation...");
  state.rafId = requestAnimationFrame(loop);
}

function wireInteractions() {
  const canvas = renderer.canvas;
  const drag = {
    active: false,
    pointerId: null,
    lastX: 0,
    lastY: 0,
    mode: "rotate",
  };
  const pitchMin = -1.35;
  const pitchMax = 1.35;

  canvas.style.cursor = "grab";
  canvas.addEventListener("contextmenu", (event) => event.preventDefault());
  canvas.addEventListener("pointerdown", (event) => {
    if (state.viewLocked) return;
    if (state.animating) {
      stopAnimation();
      setStatus("animation stopped. drag to move view.");
    }
    drag.active = true;
    drag.pointerId = event.pointerId;
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    drag.mode = (event.button === 2 || event.shiftKey) ? "pan" : "rotate";
    canvas.setPointerCapture(event.pointerId);
    canvas.style.cursor = drag.mode === "pan" ? "move" : "grabbing";
  });

  canvas.addEventListener("pointermove", (event) => {
    if (!drag.active || event.pointerId !== drag.pointerId || state.viewLocked) return;
    const dx = event.clientX - drag.lastX;
    const dy = event.clientY - drag.lastY;
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;

    if (drag.mode === "pan") {
      state.viewOffsetX += dx;
      state.viewOffsetY += dy;
    } else {
      state.camYaw += dx * 0.01;
      state.camPitch = Math.max(pitchMin, Math.min(pitchMax, state.camPitch + dy * 0.01));
    }
    drawCurrentFrame();
  });

  const releaseDrag = (event) => {
    if (!drag.active || event.pointerId !== drag.pointerId) return;
    drag.active = false;
    canvas.releasePointerCapture(event.pointerId);
    canvas.style.cursor = "grab";
  };

  canvas.addEventListener("pointerup", releaseDrag);
  canvas.addEventListener("pointercancel", releaseDrag);
  canvas.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      if (state.viewLocked) return;
      const factor = event.deltaY > 0 ? 0.93 : 1.07;
      state.zoom = Math.max(0.45, Math.min(2.2, state.zoom * factor));
      drawCurrentFrame();
    },
    { passive: false },
  );

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

  el.animateBtn.addEventListener("click", () => {
    startAnimation();
  });

  [el.exprInput, el.axisInput, el.aInput, el.bInput, el.xminInput, el.xmaxInput].forEach((input) => {
    input.addEventListener("input", () => {
      stopAnimation();
      schedulePreview();
    });
    input.addEventListener("change", () => {
      stopAnimation();
      schedulePreview();
    });
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
    state.elapsed = 0;
    state.sweepAngle = 0;
    state.camYaw = 0;
    state.camPitch = 0;
    state.viewOffsetX = 0;
    state.viewOffsetY = 0;
    state.zoom = DEFAULT_ZOOM;
    drawCurrentFrame();
    setStatus("view reset.");
  });

  el.speedInput.addEventListener("input", () => {
    el.speedValue.textContent = `${el.speedInput.value} ms`;
  });
}

async function bootstrap() {
  VizTransition.initPageTransition();

  el.homeBtn = $("homeBtn");
  el.exprInput = $("exprInput");
  el.axisInput = $("axisInput");
  el.aInput = $("aInput");
  el.bInput = $("bInput");
  el.xminInput = $("xminInput");
  el.xmaxInput = $("xmaxInput");
  el.speedInput = $("speedInput");
  el.speedValue = $("speedValue");
  el.animateBtn = $("animateBtn");
  el.pauseBtn = $("pauseBtn");
  el.resetBtn = $("resetBtn");
  el.status = $("status");
  el.latexImage = $("latexImage");
  el.readoutImage = $("readoutImage");

  renderer = new VolumeRenderer($("volumeCanvas"));
  renderer.scaleBar = window.ScaleBar?.mount(renderer.canvas.parentElement, {
    getView: volumeGetView,
    setView: volumeSetView,
  });
  renderer.viewSnap = window.ViewSnapLock?.mount(renderer.canvas.parentElement, {
    isLocked: () => state.viewLocked,
    onLock: () => lockVolumeView(),
    onUnlock: () => unlockVolumeView(),
  });
  drawCurrentFrame();

  const boot = await window.pywebview.api.get_volume_bootstrap();
  const hints = $("functionHints");
  boot.hints.forEach((h) => {
    const op = document.createElement("option");
    op.value = h;
    hints.appendChild(op);
  });

  boot.axes.forEach(([id, label]) => {
    const op = document.createElement("option");
    op.value = id;
    op.textContent = label;
    el.axisInput.appendChild(op);
  });

  const presets = $("presets");
  boot.presets.forEach(([label, expr]) => {
    const btn = document.createElement("button");
    btn.className = "preset-btn";
    btn.textContent = label;
    btn.addEventListener("click", () => {
      el.exprInput.value = expr;
      stopAnimation();
      schedulePreview();
      setStatus(`preset: ${expr}`);
    });
    presets.appendChild(btn);
  });

  wireInteractions();
  await computeModel({ preview: true });
}

whenApiReady(bootstrap);
