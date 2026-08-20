/** Shared LaTeX PNG display helpers for visualizer headers. */
window.LatexDisplay = {
  _readoutCache: new Map(),
  _readoutInflight: new Map(),

  setImage(img, png) {
    if (!img) return;
    img.src = png || "";
    img.hidden = !png;
  },

  fromData(img, data, key = "latexPng") {
    this.setImage(img, data?.[key]);
  },

  clearReadout(img) {
    this.setImage(img, "");
  },

  async renderReadout(img, payload) {
    if (!img || !window.pywebview?.api?.render_readout) return;
    const key = JSON.stringify(payload);
    if (this._readoutCache.has(key)) {
      this.setImage(img, this._readoutCache.get(key));
      return;
    }
    if (this._readoutInflight.has(key)) {
      await this._readoutInflight.get(key);
      if (this._readoutCache.has(key)) {
        this.setImage(img, this._readoutCache.get(key));
      }
      return;
    }
    const task = window.pywebview.api
      .render_readout(payload)
      .then((result) => {
        if (result?.ok && result.latexPng) {
          if (this._readoutCache.size > 64) {
            const first = this._readoutCache.keys().next().value;
            this._readoutCache.delete(first);
          }
          this._readoutCache.set(key, result.latexPng);
          this.setImage(img, result.latexPng);
        }
      })
      .finally(() => {
        this._readoutInflight.delete(key);
      });
    this._readoutInflight.set(key, task);
    await task;
  },
};
