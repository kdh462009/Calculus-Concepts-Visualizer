/**
 * Overlay x/y scale controls for a 2D plot. Updates live while panning/zooming;
 * Enter applies a typed window.
 */
(function scaleBarModule() {
  const FIELDS = ["xmin", "xmax", "ymin", "ymax"];

  function formatScale(v) {
    if (!Number.isFinite(v)) return "";
    const a = Math.abs(v);
    if (a >= 1000) return v.toFixed(0);
    if (a >= 100) return v.toFixed(1);
    if (a >= 1) return v.toFixed(2);
    if (a >= 0.01) return v.toFixed(3);
    return v.toPrecision(3);
  }

  function parseField(input) {
    const n = Number(String(input.value).trim());
    return Number.isFinite(n) ? n : null;
  }

  class ScaleBar {
    constructor(host, options) {
      this.getView = options.getView;
      this.setView = options.setView;
      this.root = document.createElement("div");
      this.root.className = "scale-bar";
      this.root.title = "Plot scale — type a range and press Enter";
      this.root.innerHTML = `
        <span class="scale-bar-k">x</span>
        <input class="scale-bar-input" data-k="xmin" type="number" step="any" inputmode="decimal" autocomplete="off" aria-label="x min">
        <span class="scale-bar-sep">–</span>
        <input class="scale-bar-input" data-k="xmax" type="number" step="any" inputmode="decimal" autocomplete="off" aria-label="x max">
        <span class="scale-bar-k">y</span>
        <input class="scale-bar-input" data-k="ymin" type="number" step="any" inputmode="decimal" autocomplete="off" aria-label="y min">
        <span class="scale-bar-sep">–</span>
        <input class="scale-bar-input" data-k="ymax" type="number" step="any" inputmode="decimal" autocomplete="off" aria-label="y max">
      `;
      this.inputs = {};
      FIELDS.forEach((k) => {
        this.inputs[k] = this.root.querySelector(`[data-k="${k}"]`);
      });
      host.appendChild(this.root);
      this._wire();
      this.sync();
    }

    editing() {
      return this.root.contains(document.activeElement);
    }

    sync(force = false) {
      if (!force && this.editing()) return;
      const view = this.getView?.();
      if (!view) return;
      FIELDS.forEach((k) => {
        const n = Number(view[k]);
        if (Number.isFinite(n)) this.inputs[k].value = formatScale(n);
      });
    }

    apply() {
      const next = {};
      for (const k of FIELDS) {
        const n = parseField(this.inputs[k]);
        if (n === null) {
          this.sync(true);
          return false;
        }
        next[k] = n;
      }
      if (next.xmin >= next.xmax || next.ymin >= next.ymax) {
        this.sync(true);
        return false;
      }
      this.setView?.(next);
      return true;
    }

    _wire() {
      this.root.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        this.apply();
        if (event.target instanceof HTMLElement) event.target.blur();
        this.sync(true);
      });
      this.root.addEventListener("change", () => this.apply());
      this.root.addEventListener("focusout", (event) => {
        if (this.root.contains(event.relatedTarget)) return;
        this.sync();
      });
      this.root.addEventListener("pointerdown", (event) => event.stopPropagation());
      this.root.addEventListener("mousedown", (event) => event.stopPropagation());
      this.root.addEventListener("wheel", (event) => event.stopPropagation());
    }
  }

  window.ScaleBar = {
    mount(host, options) {
      if (!host) return null;
      return new ScaleBar(host, options || {});
    },
  };
})();
