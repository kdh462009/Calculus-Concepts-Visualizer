/**
 * Reusable 2D function plot viewer (canvas grid, pan, zoom).
 */
const VIEW_MIN_SPAN = 1e-3;
const VIEW_MAX_SPAN = 2e4;
const MIN_VISIBLE_SAMPLES = 80;

function niceGridStep(span, targetLines) {
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

class GraphViewer {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.data = null;
    this.view = options.initialView || { xmin: -4, xmax: 4, ymin: -6, ymax: 6 };
    this.dragActive = false;
    this.dragStart = null;
    this.domainExpandTimer = null;
    this.domainExpandInFlight = false;
    this._expandGen = 0;
    this.onDomainExpand = options.onDomainExpand || null;
    this.activeParams = null;
    this.scaleBar = null;

    this._wireInteractions();
    this.attachScaleBar();
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

  notifyView() {
    this.scaleBar?.sync();
    this.onViewChange?.({ ...this.view });
  }

  setView(next) {
    if (!next) return;
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
    if (!options.preserveView && data?.xRange && data?.yRange) {
      this.view = {
        xmin: data.xRange[0],
        xmax: data.xRange[1],
        ymin: data.yRange[0],
        ymax: data.yRange[1],
      };
      this.clampView();
      this.notifyView();
    }
  }

  clearData() {
    this.data = null;
    this.activeParams = null;
    if (this.domainExpandTimer) {
      clearTimeout(this.domainExpandTimer);
      this.domainExpandTimer = null;
    }
  }

  resetView(defaultView = { xmin: -4, xmax: 4, ymin: -6, ymax: 6 }) {
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
    this.notifyView();
  }

  setupCanvasResolution() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(400, Math.floor(rect.width * dpr));
    const h = Math.max(320, Math.floor(rect.height * dpr));
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

  _needsResample() {
    if (!this.data?.xRange || !this.data?.x?.length) return false;
    const [domainMin, domainMax] = this.data.xRange;
    const { xmin, xmax } = this.view;
    if (xmin < domainMin || xmax > domainMax) return true;
    return this._visibleSampleCount() < MIN_VISIBLE_SAMPLES;
  }

  drawLine(xs, ys, color, width = 2.6, alpha = 1.0) {
    const ctx = this.ctx;
    ctx.strokeStyle = color;
    ctx.lineWidth = width * (window.devicePixelRatio || 1);
    ctx.globalAlpha = alpha;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    let drawing = false;
    ctx.beginPath();
    for (let i = 0; i < xs.length; i += 1) {
      const y = ys[i];
      if (y === null) {
        drawing = false;
        continue;
      }
      if (drawing && i > 0 && ys[i - 1] !== null) {
        const prev = ys[i - 1];
        const ySpan = Math.abs(this.view.ymax - this.view.ymin) || 1;
        const jump = Math.abs(y - prev);
        if (jump > ySpan * 0.9 && prev * y < 0) {
          drawing = false;
        }
      }
      const [sx, sy] = this.worldToScreen(xs[i], y);
      if (!drawing) {
        ctx.moveTo(sx, sy);
        drawing = true;
      } else {
        ctx.lineTo(sx, sy);
      }
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
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
    this.notifyView();
  }

  scheduleDomainExpansion() {
    if (!this.data || !this.activeParams || !this.onDomainExpand) return;
    this._expandGen += 1;
    if (this.domainExpandTimer) clearTimeout(this.domainExpandTimer);
    this.domainExpandTimer = setTimeout(() => this._ensureDomainCoverage(), 140);
  }

  async _ensureDomainCoverage() {
    if (!this.data || !this.activeParams || this.domainExpandInFlight || !this.onDomainExpand) {
      return;
    }
    if (!this._needsResample()) return;

    const gen = this._expandGen;
    const { xmin, xmax } = this.view;
    const span = Math.max(xmax - xmin, VIEW_MIN_SPAN);
    const pad = Math.max(span * 0.12, 0.05);
    const payload = {
      ...this.activeParams,
      xmin: xmin - pad,
      xmax: xmax + pad,
    };

    this.domainExpandInFlight = true;
    try {
      const result = await this.onDomainExpand(payload);
      if (gen !== this._expandGen) return;
      if (!result?.ok) return;

      if (this.onDataExpanded) {
        this.onDataExpanded(result, payload);
      } else {
        this.setData(result, payload, { preserveView: true });
      }
      this.redraw();
    } finally {
      this.domainExpandInFlight = false;
    }

    if (gen !== this._expandGen) this.scheduleDomainExpansion();
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
      this.dragActive = true;
      this.dragStart = { x: e.clientX, y: e.clientY, view: { ...this.view } };
      this.canvas.style.cursor = "grabbing";
    });

    window.addEventListener("mouseup", () => {
      this.dragActive = false;
      this.canvas.style.cursor = "crosshair";
    });

    window.addEventListener("mousemove", (e) => {
      if (!this.dragActive) return;
      const dx = e.clientX - this.dragStart.x;
      const dy = e.clientY - this.dragStart.y;
      const w = this.canvas.getBoundingClientRect().width;
      const h = this.canvas.getBoundingClientRect().height;
      const xv = this.dragStart.view.xmax - this.dragStart.view.xmin;
      const yv = this.dragStart.view.ymax - this.dragStart.view.ymin;
      this.view.xmin = this.dragStart.view.xmin - (dx / w) * xv;
      this.view.xmax = this.dragStart.view.xmax - (dx / w) * xv;
      this.view.ymin = this.dragStart.view.ymin + (dy / h) * yv;
      this.view.ymax = this.dragStart.view.ymax + (dy / h) * yv;
      this.clampView();
      this.redraw();
      if (this.data) this.scheduleDomainExpansion();
    });

    this.canvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        if (!e.deltaY) return;
        const zoom = e.deltaY > 0 ? 1.1 : 0.9;
        const rect = this.canvas.getBoundingClientRect();
        const sx = (e.clientX - rect.left) * (window.devicePixelRatio || 1);
        const sy = (e.clientY - rect.top) * (window.devicePixelRatio || 1);
        const [wx, wy] = this.screenToWorld(sx, sy);
        this.view.xmin = wx + (this.view.xmin - wx) * zoom;
        this.view.xmax = wx + (this.view.xmax - wx) * zoom;
        this.view.ymin = wy + (this.view.ymin - wy) * zoom;
        this.view.ymax = wy + (this.view.ymax - wy) * zoom;
        this.clampView();
        this.redraw();
        if (this.data) this.scheduleDomainExpansion();
      },
      { passive: false },
    );

    window.addEventListener("resize", () => this.redraw());
  }
}

window.GraphViewer = GraphViewer;
