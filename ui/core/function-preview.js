/**
 * Plot f(x) on input before approximation animations (Taylor, Riemann, etc.).
 */
window.FunctionPreview = {
  PREVIEW_HOLD_MS: 900,

  delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  },

  drawFunctionOnly(viewer) {
    if (!viewer?.data?.yTrue) {
      viewer.drawGrid();
      return;
    }
    viewer.draw([
      { ys: viewer.data.yTrue, color: "#2ee8bb", width: 2.55, alpha: 0.92 },
    ]);
  },

  wire({
    viewer,
    exprInput,
    extraInputs = [],
    getPayload,
    previewApi,
    onBeforePlot,
    onPlotted,
    onError,
    debounceMs = 400,
  }) {
    let timer = null;

    const plot = async () => {
      const payload = getPayload();
      if (!payload?.expr?.trim()) return;
      onBeforePlot?.();
      const result = await previewApi(payload);
      if (!result?.ok) {
        onError?.(result.error);
        return;
      }
      viewer.setData(result, { ...payload, preview: true });
      FunctionPreview.drawFunctionOnly(viewer);
      onPlotted?.();
    };

    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(plot, debounceMs);
    };

    const plotNow = () => {
      clearTimeout(timer);
      return plot();
    };

    exprInput.addEventListener("input", schedule);
    exprInput.addEventListener("change", schedule);
    exprInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") plotNow();
    });
    extraInputs.forEach((input) => {
      input.addEventListener("input", schedule);
      input.addEventListener("change", schedule);
    });

    return { plot, plotNow, schedule };
  },
};
