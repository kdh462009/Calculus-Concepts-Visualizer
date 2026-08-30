/**
 * Reusable 2D function plot viewer (canvas grid, pan, zoom).
 */
const VIEW_MIN_SPAN = 1e-3;
const VIEW_MAX_SPAN = 2e4;
const MIN_VISIBLE_SAMPLES = 80;
const MAX_MERGED_SAMPLES = 16000;

function niceGridStep(span, targetLines) {
  if (typeof window.GraphAxisLabels?.niceStep === "function") {
    return window.GraphAxisLabels.niceStep(span, targetLines);
  }
  if (!Number.isFinite(span) || span <= 0) return 1;
  const raw = span / Math.max(targetLines, 1);
  const exp = 10 ** Math.floor(Math.log10(raw));
  const frac = raw / exp;
  const nice = frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 5 ? 5 : 10;
  return nice * exp;
}

function clampSpan(min, max, limitMin, limitMax) {
  let lo = min;
  let hi = max;
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) {
    return { min: -4, max: 4 };
  }
  const mid = (lo + hi) / 2;
  let span = hi - lo;
  if (span < limitMin) span = limitMin;
  if (span > limitMax) span = limitMax;
  return { min: mid - span / 2, max: mid + span / 2 };
}

function alignedSeriesKeys(data) {
  if (!data?.x?.length) return [];
  return Object.keys(data).filter(
    (k) => k !== "x" && k !== "partials" && Array.isArray(data[k]) && data[k].length === data.x.length,
  );
}

function takeSeriesIndices(data, indices) {
  const pick = (arr) => indices.map((i) => arr[i]);
  const next = { ...data, x: pick(data.x) };
  for (const k of alignedSeriesKeys(data)) {
    next[k] = pick(data[k]);
  }
  if (Array.isArray(data.partials)) {
    next.partials = data.partials.map((series) =>
      Array.isArray(series) && series.length === data.x.length ? pick(series) : series,
    );
  }
  if (next.x.length) {
    next.xRange = [next.x[0], next.x[next.x.length - 1]];
  }
  return next;
}

function mergeYRange(prev, next) {
  const a = prev?.yRange;
  const b = next?.yRange;
  if (!Array.isArray(a) || a.length < 2) return Array.isArray(b) ? b : a;
  if (!Array.isArray(b) || b.length < 2) return a;
  const lo = Math.min(a[0], b[0]);
  const hi = Math.max(a[1], b[1]);
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) return b;
  return [lo, hi];
}

class GraphViewer {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.data = null;
    this.view = options.initialView || { xmin: -4, xmax: 4, ymin: -6, ymax: 6 };
    this._defaultView = { ...this.view };
    this.dragActive = false;
    this.dragStart = null;
    this.domainExpandTimer = null;
    this.domainExpandInFlight = false;
    this._expandGen = 0;
    this._expandQueued = false;
    this._redrawFrame = null;
    this.onDomainExpand = options.onDomainExpand || null;
    this.onGetSnapView = options.onGetSnapView || null;
    this.activeParams = null;
    this.scaleBar = null;
    this.viewSnap = null;
    this.viewLocked = false;
    this._snapping = false;
    this._snapView = null;

    this._wireInteractions();
    this.attachScaleBar();
    this.attachViewSnap();
  }

  attachScaleBar() {
    if (typeof window.ScaleBar?.mount !== "function") return;
    const host = this.canvas?.parentElement;
    if (!host || this.scaleBar) return;
    this.scaleBar = window.ScaleBar.mount(host, {
      getView: () => this.view,
      setView: (view) => this.setView(view),
    });
  }

  attachViewSnap() {
    if (typeof window.ViewSnapLock?.mount !== "function") return;
    const host = this.canvas?.parentElement;
    if (!host || this.viewSnap) return;
    this.viewSnap = window.ViewSnapLock.mount(host, {
      isLocked: () => this.viewLocked,
      onLock: () => this.lockView(),
      onUnlock: () => this.unlockView(),
      onSnap: () => this.applySnapView(),
    });
  }

  syncLockChrome() {
    this.viewSnap?.sync();
    this.scaleBar?.root?.classList.toggle("is-view-locked", this.viewLocked);
  }

  rememberSnapView(source = this.view) {
    if (!source) return;
    const xmin = Number(source.xmin);
    const xmax = Number(source.xmax);
    const ymin = Number(source.ymin);
    const ymax = Number(source.ymax);
    if (!(Number.isFinite(xmin) && Number.isFinite(xmax) && xmax > xmin)) return;
    if (!(Number.isFinite(ymin) && Number.isFinite(ymax) && ymax > ymin)) return;
    this._snapView = { xmin, xmax, ymin, ymax };
  }

  getSnapView() {
    if (typeof this.onGetSnapView === "function") {
      const custom = this.onGetSnapView();
      if (custom) {
        const xmin = Number(custom.xmin);
        const xmax = Number(custom.xmax);
        const ymin = Number(custom.ymin);
        const ymax = Number(custom.ymax);
        if (
          Number.isFinite(xmin) && Number.isFinite(xmax) && xmax > xmin
          && Number.isFinite(ymin) && Number.isFinite(ymax) && ymax > ymin
        ) {
          return { xmin, xmax, ymin, ymax };
        }
      }
    }
    if (this._snapView) return { ...this._snapView };
    if (this.data?.xRange && this.data?.yRange) {
      return {
        xmin: this.data.xRange[0],
        xmax: this.data.xRange[1],
        ymin: this.data.yRange[0],
        ymax: this.data.yRange[1],
      };
    }
    return { ...this._defaultView };
  }

  applySnapView() {
    this._snapping = true;
    try {
      const snap = this.getSnapView();
      this.view.xmin = snap.xmin;
      this.view.xmax = snap.xmax;
      this.view.ymin = snap.ymin;
      this.view.ymax = snap.ymax;
      this.clampView();
      this.redraw();
      this.notifyView();
      // Zoom-trim can drop samples; refill the home window now, not after
      // the pan debounce, so lock/resnap is not briefly empty.
      if (this.data && this.onDomainExpand) {
        if (this.domainExpandTimer) {
          clearTimeout(this.domainExpandTimer);
          this.domainExpandTimer = null;
        }
        this._ensureDomainCoverage();
      }
    } finally {
      this._snapping = false;
    }
  }

  lockView() {
    this.viewLocked = true;
    this.syncLockChrome();
  }

  unlockView() {
    this.viewLocked = false;
    this.syncLockChrome();
  }

  notifyView() {
    this.scaleBar?.sync();
    this.onViewChange?.({ ...this.view });
  }

  setView(next) {
    if (!next) return;
    if (this.viewLocked && !this._snapping) {
      // Scale-bar edits count as a user move: unlock, then apply.
      this.viewLocked = false;
      this.syncLockChrome();
    }
    if (Number.isFinite(next.xmin)) this.view.xmin = next.xmin;
    if (Number.isFinite(next.xmax)) this.view.xmax = next.xmax;
    if (Number.isFinite(next.ymin)) this.view.ymin = next.ymin;
    if (Number.isFinite(next.ymax)) this.view.ymax = next.ymax;
    this.clampView();
    this.redraw();
    if (this.data) this.scheduleDomainExpansion();
  }

  setData(data, activeParams = null, options = {}) {
    this.data = data;
    this.activeParams = activeParams;
    const fitFromData = !options.preserveView && data?.xRange && data?.yRange;
    if (fitFromData) {
      const fitted = {
        xmin: data.xRange[0],
        xmax: data.xRange[1],
        ymin: data.yRange[0],
        ymax: data.yRange[1],
      };
      this.rememberSnapView(fitted);
      if (this.viewLocked) {
        this.applySnapView();
        return;
      }
      this.view = { ...fitted };
      this.clampView();
      this.notifyView();
      return;
    }
    if (this.viewLocked) {
      this.applySnapView();
    }
  }

  clearData() {
    this.data = null;
    this.activeParams = null;
    this._snapView = null;
    if (this.domainExpandTimer) {
      clearTimeout(this.domainExpandTimer);
      this.domainExpandTimer = null;
    }
  }

  resetView(defaultView = { xmin: -4, xmax: 4, ymin: -6, ymax: 6 }) {
    this._defaultView = { ...defaultView };
    if (this.data?.xRange && this.data?.yRange) {
      this.view = {
        xmin: this.data.xRange[0],
        xmax: this.data.xRange[1],
        ymin: this.data.yRange[0],
        ymax: this.data.yRange[1],
      };
    } else {
      this.view = { ...defaultView };
    }
    this.clampView();
    this.rememberSnapView(this.view);
    this.notifyView();
  }

  setupCanvasResolution() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    // Match the CSS box exactly. Flooring / min-size mismatches vs the
    // displayed size make wheel-zoom anchors drift left/right.
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  worldToScreen(x, y) {
    const { xmin, xmax, ymin, ymax } = this.view;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const dx = xmax - xmin || 1;
    const dy = ymax - ymin || 1;
    const sx = ((x - xmin) / dx) * w;
    const sy = h - ((y - ymin) / dy) * h;
    return [sx, sy];
  }

  screenToWorld(sx, sy) {
    const { xmin, xmax, ymin, ymax } = this.view;
    const w = this.canvas.width || 1;
    const h = this.canvas.height || 1;
    const x = xmin + (sx / w) * (xmax - xmin);
    const y = ymin + ((h - sy) / h) * (ymax - ymin);
    return [x, y];
  }

  /** Mouse/client point → world, using CSS box fractions (DPR-safe). */
  clientToWorld(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const w = rect.width || 1;
    const h = rect.height || 1;
    const fx = (clientX - rect.left) / w;
    const fy = (clientY - rect.top) / h;
    const { xmin, xmax, ymin, ymax } = this.view;
    return [
      xmin + fx * (xmax - xmin),
      ymax - fy * (ymax - ymin),
    ];
  }

  clampView() {
    const x = clampSpan(this.view.xmin, this.view.xmax, VIEW_MIN_SPAN, VIEW_MAX_SPAN);
    const y = clampSpan(this.view.ymin, this.view.ymax, VIEW_MIN_SPAN, VIEW_MAX_SPAN);
    this.view.xmin = x.min;
    this.view.xmax = x.max;
    this.view.ymin = y.min;
    this.view.ymax = y.max;
  }

  _visibleSampleCount() {
    const xs = this.data?.x;
    if (!xs?.length) return 0;
    const { xmin, xmax } = this.view;
    let n = 0;
    for (let i = 0; i < xs.length; i += 1) {
      const x = xs[i];
      if (x >= xmin && x <= xmax) {
        n += 1;
        if (n >= MIN_VISIBLE_SAMPLES) return n;
      }
    }
    return n;
  }

  _keepXRange() {
    const p = this.activeParams || {};
    let lo = Infinity;
    let hi = -Infinity;
    const a = Number(p.a);
    const b = Number(p.b);
    if (Number.isFinite(a) && Number.isFinite(b)) {
      lo = Math.min(a, b);
      hi = Math.max(a, b);
    }
    const bx0 = Number(p.boundXmin);
    const bx1 = Number(p.boundXmax);
    if (Number.isFinite(bx0) && Number.isFinite(bx1)) {
      lo = Math.min(lo, bx0, bx1);
      hi = Math.max(hi, bx0, bx1);
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) return null;
    const pad = Math.max((hi - lo) * 0.02, 1e-6);
    return [lo - pad, hi + pad];
  }

  _domainCovers(range) {
    if (!range || !this.data?.x?.length) return false;
    return this.data.x[0] <= range[0] && this.data.x[this.data.x.length - 1] >= range[1];
  }

  _needsResample() {
    if (!this.data?.xRange || !this.data?.x?.length) return false;
    const [domainMin, domainMax] = this.data.xRange;
    const { xmin, xmax } = this.view;
    if (xmin < domainMin || xmax > domainMax) return true;
    const keep = this._keepXRange();
    if (keep && !this._domainCovers(keep)) return true;
    return this._visibleSampleCount() < MIN_VISIBLE_SAMPLES;
  }

  _mergePlotData(prev, next) {
    if (!prev?.x?.length) return next;
    if (!next?.x?.length) return prev;

    const nLo = next.x[0];
    const nHi = next.x[next.x.length - 1];
    if (!Number.isFinite(nLo) || !Number.isFinite(nHi) || nHi < nLo) return next;

    const keys = new Set([...alignedSeriesKeys(prev), ...alignedSeriesKeys(next)]);
    const pCount = Math.max(prev.partials?.length || 0, next.partials?.length || 0);
    const xs = [];
    const cols = {};
    keys.forEach((k) => {
      cols[k] = [];
    });
    const partials = Array.from({ length: pCount }, () => []);

    const push = (src, i) => {
      const xlen = src.x.length;
      xs.push(src.x[i]);
      keys.forEach((k) => {
        cols[k].push(Array.isArray(src[k]) && src[k].length === xlen ? src[k][i] : null);
      });
      for (let p = 0; p < pCount; p += 1) {
        const series = src.partials?.[p];
        partials[p].push(Array.isArray(series) && series.length === xlen ? series[i] : null);
      }
    };

    for (let i = 0; i < prev.x.length; i += 1) {
      if (prev.x[i] < nLo) push(prev, i);
    }
    for (let j = 0; j < next.x.length; j += 1) push(next, j);
    for (let i = 0; i < prev.x.length; i += 1) {
      if (prev.x[i] > nHi) push(prev, i);
    }

    const merged = { ...prev, ...next, x: xs, ...cols, yRange: mergeYRange(prev, next) };
    if (xs.length) merged.xRange = [xs[0], xs[xs.length - 1]];
    if (pCount) merged.partials = partials;
    return this._trimMergedData(merged);
  }

  _trimMergedData(data) {
    if (!data?.x || data.x.length <= MAX_MERGED_SAMPLES) return data;
    const { xmin, xmax } = this.view;
    const span = Math.max(xmax - xmin, VIEW_MIN_SPAN);
    let lo = xmin - span * 4;
    let hi = xmax + span * 4;
    const keep = this._keepXRange();
    if (keep) {
      lo = Math.min(lo, keep[0]);
      hi = Math.max(hi, keep[1]);
    }
    // Never discard the home snap window — otherwise lock/resnap shows
    // truncated curves until a later expand happens to refill them.
    if (this._snapView) {
      lo = Math.min(lo, this._snapView.xmin);
      hi = Math.max(hi, this._snapView.xmax);
    }

    const must = [];
    const extra = [];
    for (let i = 0; i < data.x.length; i += 1) {
      if (data.x[i] >= lo && data.x[i] <= hi) must.push(i);
      else extra.push(i);
    }

    let idx = must;
    if (idx.length > MAX_MERGED_SAMPLES) {
      const step = Math.ceil(idx.length / MAX_MERGED_SAMPLES);
      idx = idx.filter((_, n) => n % step === 0);
    } else if (extra.length) {
      const room = MAX_MERGED_SAMPLES - idx.length;
      const step = Math.max(1, Math.ceil(extra.length / room));
      extra.forEach((i, n) => {
        if (n % step === 0) idx.push(i);
      });
      idx.sort((a, b) => a - b);
    }
    return takeSeriesIndices(data, idx);
  }

  drawLine(xs, ys, color, width = 2.6, alpha = 1.0) {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    // Keep projected points near the canvas. Huge screen coords (steep
    // cubics when zoomed in) make Chromium/WebKit drop the entire stroke.
    const maxCoord = Math.max(w, h) * 8;
    const clampScreen = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.clip();
    ctx.strokeStyle = color;
    ctx.lineWidth = width * (window.devicePixelRatio || 1);
    ctx.globalAlpha = alpha;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    let drawing = false;
    ctx.beginPath();
    for (let i = 0; i < xs.length; i += 1) {
      const y = ys[i];
      if (y === null || !Number.isFinite(y) || !Number.isFinite(xs[i])) {
        drawing = false;
        continue;
      }
      let [sx, sy] = this.worldToScreen(xs[i], y);
      if (!Number.isFinite(sx) || !Number.isFinite(sy)) {
        drawing = false;
        continue;
      }
      sx = clampScreen(sx, -maxCoord, w + maxCoord);
      sy = clampScreen(sy, -maxCoord, h + maxCoord);
      if (!drawing) {
        ctx.moveTo(sx, sy);
        drawing = true;
      } else {
        ctx.lineTo(sx, sy);
      }
    }
    ctx.stroke();
    ctx.restore();
  }

  drawGrid() {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    ctx.clearRect(0, 0, w, h);

    const grad = ctx.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, "#1d2742");
    grad.addColorStop(1, "#131c33");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    const { xmin, xmax, ymin, ymax } = this.view;
    const xSpan = xmax - xmin;
    const ySpan = ymax - ymin;
    if (!Number.isFinite(xSpan) || !Number.isFinite(ySpan) || xSpan <= 0 || ySpan <= 0) {
      return;
    }

    ctx.strokeStyle = "rgba(90, 109, 161, 0.40)";
    ctx.lineWidth = 1;
    const stepX = niceGridStep(xSpan, 10);
    const stepY = niceGridStep(ySpan, 8);
    const startX = Math.ceil(xmin / stepX) * stepX;
    const startY = Math.ceil(ymin / stepY) * stepY;

    let count = 0;
    for (let gx = startX; gx <= xmax + stepX * 0.5 && count < 48; gx += stepX) {
      const [sx] = this.worldToScreen(gx, ymin);
      ctx.beginPath();
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, h);
      ctx.stroke();
      count += 1;
    }
    count = 0;
    for (let gy = startY; gy <= ymax + stepY * 0.5 && count < 48; gy += stepY) {
      const [, sy] = this.worldToScreen(xmin, gy);
      ctx.beginPath();
      ctx.moveTo(0, sy);
      ctx.lineTo(w, sy);
      ctx.stroke();
      count += 1;
    }

    const [x0] = this.worldToScreen(0, ymin);
    const [, y0] = this.worldToScreen(xmin, 0);
    ctx.strokeStyle = "rgba(188, 200, 240, 0.7)";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(x0, 0);
    ctx.lineTo(x0, h);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, y0);
    ctx.lineTo(w, y0);
    ctx.stroke();

    window.GraphAxisLabels?.drawCartesian?.(ctx, {
      worldToScreen: (x, y) => this.worldToScreen(x, y),
      xmin,
      xmax,
      ymin,
      ymax,
      width: w,
      height: h,
      stepX,
      stepY,
    });
  }

  draw(layers = []) {
    this.setupCanvasResolution();
    this.drawGrid();
    if (this.data) {
      for (const layer of layers) {
        if (!layer?.ys) continue;
        this.drawLine(this.data.x, layer.ys, layer.color, layer.width, layer.alpha);
      }
    }
  }

  scheduleRedraw() {
    if (this._redrawFrame !== null) return;
    this._redrawFrame = requestAnimationFrame(() => {
      this._redrawFrame = null;
      this.redraw();
    });
  }

  scheduleDomainExpansion() {
    if (!this.data || !this.activeParams || !this.onDomainExpand) return;
    this._expandGen += 1;
    if (this.domainExpandInFlight) {
      this._expandQueued = true;
      if (this.domainExpandTimer) {
        clearTimeout(this.domainExpandTimer);
        this.domainExpandTimer = null;
      }
      return;
    }
    if (this.domainExpandTimer) clearTimeout(this.domainExpandTimer);
    this.domainExpandTimer = setTimeout(() => this._ensureDomainCoverage(), 140);
  }

  async _ensureDomainCoverage() {
    if (!this.data || !this.activeParams || !this.onDomainExpand) return;
    if (this.domainExpandInFlight) {
      this._expandQueued = true;
      return;
    }
    if (!this._needsResample()) {
      this._expandQueued = false;
      return;
    }

    const gen = this._expandGen;
    const prev = this.data;
    const { xmin, xmax } = this.view;
    const span = Math.max(xmax - xmin, VIEW_MIN_SPAN);
    const pad = Math.max(span * 0.12, 0.05);
    let reqMin = xmin - pad;
    let reqMax = xmax + pad;
    const keep = this._keepXRange();
    if (keep && !this._domainCovers(keep)) {
      reqMin = Math.min(reqMin, keep[0]);
      reqMax = Math.max(reqMax, keep[1]);
    }
    const payload = {
      ...this.activeParams,
      xmin: reqMin,
      xmax: reqMax,
    };

    this.domainExpandInFlight = true;
    this._expandQueued = false;
    try {
      const result = await this.onDomainExpand(payload);
      if (gen === this._expandGen && !this._expandQueued && result?.ok && this.data === prev) {
        const merged = this._mergePlotData(prev, result);
        if (this.onDataExpanded) {
          this.onDataExpanded(merged, payload);
        } else {
          this.setData(merged, payload, { preserveView: true });
        }
        this.redraw();
      }
    } catch {
      // Swallow bridge / parse failures so pan/zoom expansion can retry.
    } finally {
      this.domainExpandInFlight = false;
    }

    if (gen !== this._expandGen || this._expandQueued) {
      this.scheduleDomainExpansion();
    }
  }

  setRedrawHandler(fn) {
    this._redraw = fn;
  }

  redraw() {
    if (this._redraw) {
      this._redraw();
    } else {
      this.draw();
    }
    this.notifyView();
  }

  _wireInteractions() {
    this.canvas.addEventListener("mousedown", (e) => {
      if (this.viewLocked) return;
      this.dragActive = true;
      this.dragStart = { x: e.clientX, y: e.clientY, view: { ...this.view } };
      this.canvas.style.cursor = "grabbing";
    });

    window.addEventListener("mouseup", () => {
      this.dragActive = false;
      this.canvas.style.cursor = "crosshair";
    });

    window.addEventListener("mousemove", (e) => {
      if (!this.dragActive || this.viewLocked) return;
      const dx = e.clientX - this.dragStart.x;
      const dy = e.clientY - this.dragStart.y;
      const rect = this.canvas.getBoundingClientRect();
      const w = rect.width || 1;
      const h = rect.height || 1;
      const xv = this.dragStart.view.xmax - this.dragStart.view.xmin;
      const yv = this.dragStart.view.ymax - this.dragStart.view.ymin;
      this.view.xmin = this.dragStart.view.xmin - (dx / w) * xv;
      this.view.xmax = this.dragStart.view.xmax - (dx / w) * xv;
      this.view.ymin = this.dragStart.view.ymin + (dy / h) * yv;
      this.view.ymax = this.dragStart.view.ymax + (dy / h) * yv;
      this.clampView();
      this.scheduleRedraw();
      if (this.data) this.scheduleDomainExpansion();
    });

    this.canvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        if (this.viewLocked || !e.deltaY) return;
        const zoom = e.deltaY > 0 ? 1.1 : 0.9;
        const [wx, wy] = this.clientToWorld(e.clientX, e.clientY);
        this.view.xmin = wx + (this.view.xmin - wx) * zoom;
        this.view.xmax = wx + (this.view.xmax - wx) * zoom;
        this.view.ymin = wy + (this.view.ymin - wy) * zoom;
        this.view.ymax = wy + (this.view.ymax - wy) * zoom;
        this.clampView();
        this.scheduleRedraw();
        if (this.data) this.scheduleDomainExpansion();
      },
      { passive: false },
    );

    window.addEventListener("resize", () => this.scheduleRedraw());
  }
}

window.GraphViewer = GraphViewer;
