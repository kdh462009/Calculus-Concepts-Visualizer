/** Shared LaTeX PNG display helpers for visualizer headers. */
window.LatexDisplay = {
  setImage(img, png) {
    if (!img) return;
    img.src = png || "";
  },

  fromData(img, data, key = "latexPng") {
    this.setImage(img, data?.[key]);
  },
};
