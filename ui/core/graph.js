/**
 * Reusable 2D function plot viewer (canvas grid, pan, zoom).
 */
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
    this.onDomainExpand = options.onDomainExpand || null;
    this.activeParams = null;

    this._wireInteractions();
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
    const sx = ((x - xmin) / (xmax - xmin)) * w;
    const sy = h - ((y - ymin) / (ymax - ymin)) * h;
    return [sx, sy];
  }

  screenToWorld(sx, sy) {
    const { xmin, xmax, ymin, ymax } = this.view;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const x = xmin + (sx / w) * (xmax - xmin);
    const y = ymin + ((h - sy) / h) * (ymax - ymin);
    return [x, y];
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
        const jump = Math.abs(y - prev);
        if (jump > 12 && prev * y < 0 && Math.abs(prev) > 6 && Math.abs(y) > 6) {
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

    ctx.strokeStyle = "rgba(90, 109, 161, 0.40)";
    ctx.lineWidth = 1;
    const { xmin, xmax, ymin, ymax } = this.view;
    const stepX = (xmax - xmin) / 10;
    const stepY = (ymax - ymin) / 8;

    for (let gx = xmin; gx <= xmax; gx += stepX) {
      const [sx] = this.worldToScreen(gx, ymin);
      ctx.beginPath();
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, h);
      ctx.stroke();
    }
    for (let gy = ymin; gy <= ymax; gy += stepY) {
      const [, sy] = this.worldToScreen(xmin, gy);
      ctx.beginPath();
      ctx.moveTo(0, sy);
      ctx.lineTo(w, sy);
      ctx.stroke();
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
    if (!this.data) return;
    for (const layer of layers) {
      this.drawLine(this.data.x, layer.ys, layer.color, layer.width, layer.alpha);
    }
  }

  scheduleDomainExpansion() {
    if (!this.data || !this.activeParams || !this.onDomainExpand) return;
    if (this.domainExpandTimer) clearTimeout(this.domainExpandTimer);
    this.domainExpandTimer = setTimeout(() => this._ensureDomainCoverage(), 180);
  }

  async _ensureDomainCoverage() {
    if (!this.data || !this.activeParams || this.domainExpandInFlight || !this.onDomainExpand) {
      return;
    }
    const [domainMin, domainMax] = this.data.xRange;
    const { xmin, xmax } = this.view;
    if (xmin >= domainMin && xmax <= domainMax) return;

    const span = xmax - xmin;
    const pad = Math.max(0.5, span * 0.2);
    const reqMin = Math.min(xmin, domainMin) - pad;
    const reqMax = Math.max(xmax, domainMax) + pad;

    this.domainExpandInFlight = true;
    const payload = {
      ...this.activeParams,
      xmin: reqMin,
      xmax: reqMax,
    };
    try {
      const result = await this.onDomainExpand(payload);
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
      this.redraw();
      if (this.data) this.scheduleDomainExpansion();
    });

    this.canvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const zoom = e.deltaY > 0 ? 1.08 : 0.92;
        const rect = this.canvas.getBoundingClientRect();
        const sx = (e.clientX - rect.left) * (window.devicePixelRatio || 1);
        const sy = (e.clientY - rect.top) * (window.devicePixelRatio || 1);
        const [wx, wy] = this.screenToWorld(sx, sy);
        this.view.xmin = wx + (this.view.xmin - wx) * zoom;
        this.view.xmax = wx + (this.view.xmax - wx) * zoom;
        this.view.ymin = wy + (this.view.ymin - wy) * zoom;
        this.view.ymax = wy + (this.view.ymax - wy) * zoom;
        this.redraw();
        if (this.data) this.scheduleDomainExpansion();
      },
      { passive: false },
    );

    window.addEventListener("resize", () => this.redraw());
  }
}

window.GraphViewer = GraphViewer;
