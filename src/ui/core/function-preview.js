/**
 * Plot f(x) on input before approximation animations (Taylor, Riemann, etc.).
 */
window.FunctionPreview = {
  PREVIEW_HOLD_MS: 180,

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
    /** Return false to drop a completed preview (e.g. Animate started). */
    canApply = null,
    debounceMs = 160,
  }) {
    let timer = null;
    let previewGen = 0;

    const invalidate = () => {
      previewGen += 1;
      clearTimeout(timer);
      timer = null;
    };

    const plot = async () => {
      const payload = getPayload();
      if (!payload?.expr?.trim()) return;
      const gen = ++previewGen;
      onBeforePlot?.();
      const result = await previewApi(payload);
      // Re-check after every await / callback — Animate may invalidate mid-flight.
      if (gen !== previewGen) return;
      if (typeof canApply === "function" && !canApply()) return;
      if (gen !== previewGen) return;
      if (!result?.ok) {
        onError?.(result.error);
        return;
      }
      if (gen !== previewGen) return;
      if (typeof canApply === "function" && !canApply()) return;
      viewer.setData(result, { ...payload, preview: true });
      if (gen !== previewGen) return;
      FunctionPreview.drawFunctionOnly(viewer);
      if (gen !== previewGen) return;
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
    exprInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") plotNow();
    });
    extraInputs.forEach((input) => {
      input.addEventListener("input", schedule);
    });

    return { plot, plotNow, schedule, invalidate };
  },
};
