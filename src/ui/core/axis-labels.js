/**
 * Light numeric labels for cartesian (and polar radius) graph grids.
 * Updates whenever the host redraws after pan/zoom.
 */
(function () {
  function niceStep(span, targetLines) {
    if (!Number.isFinite(span) || span <= 0) return 1;
    const raw = span / Math.max(targetLines, 1);
    const exp = 10 ** Math.floor(Math.log10(raw));
    const frac = raw / exp;
    const nice = frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 5 ? 5 : 10;
    return nice * exp;
  }

  function formatTick(value, step) {
    if (!Number.isFinite(value)) return "";
    if (Math.abs(value) < Math.abs(step) * 1e-9) return "0";
    const abs = Math.abs(value);
    const absStep = Math.abs(step) || 1;
    if (abs >= 1e4 || (abs > 0 && abs < 1e-3 && absStep < 1e-3)) {
      return value.toExponential(1).replace(/\.0e/, "e").replace(/e\+?/, "e");
    }
    let decimals = 0;
    if (absStep < 1) {
      decimals = Math.min(6, Math.max(0, Math.ceil(-Math.log10(absStep) + 1e-12)));
    }
    let s = value.toFixed(decimals);
    if (decimals > 0) s = s.replace(/\.?0+$/, "");
    return s;
  }

  function drawCartesian(ctx, {
    worldToScreen,
    xmin,
    xmax,
    ymin,
    ymax,
    width,
    height,
    stepX,
    stepY,
    pad = 6,
    /** 1 when ctx already applies devicePixelRatio via setTransform. */
    pixelScale = null,
  }) {
    const dpr = pixelScale == null ? (window.devicePixelRatio || 1) : pixelScale;
    const fontSize = Math.max(9, Math.round(10.5 * dpr));
    const edge = pad * dpr;
    ctx.save();
    ctx.font = `${fontSize}px "IBM Plex Mono", "SF Mono", ui-monospace, Menlo, Consolas, monospace`;
    ctx.fillStyle = "rgba(168, 182, 220, 0.52)";
    ctx.textBaseline = "middle";

    const [xAxisSx] = worldToScreen(0, ymin);
    const [, yAxisSy] = worldToScreen(xmin, 0);
    const xAxisOnScreen = xAxisSx >= edge && xAxisSx <= width - edge;
    const yAxisOnScreen = yAxisSy >= edge && yAxisSy <= height - edge;

    const labelAlongX = yAxisOnScreen
      ? yAxisSy
      : (Math.abs(ymin) < Math.abs(ymax) ? height - edge : edge);
    const labelAlongY = xAxisOnScreen
      ? xAxisSx
      : (Math.abs(xmin) < Math.abs(xmax) ? edge : width - edge);

    const startX = Math.ceil(xmin / stepX) * stepX;
    const startY = Math.ceil(ymin / stepY) * stepY;
    let count = 0;
    for (let gx = startX; gx <= xmax + stepX * 0.5 && count < 48; gx += stepX) {
      count += 1;
      if (Math.abs(gx) < stepX * 1e-9) continue;
      const [sx] = worldToScreen(gx, ymin);
      if (sx < edge + 4 || sx > width - edge - 4) continue;
      const text = formatTick(gx, stepX);
      ctx.textAlign = "center";
      const above = labelAlongX > height * 0.5;
      const ty = above
        ? Math.min(height - edge, labelAlongX + fontSize * 0.85)
        : Math.max(edge + fontSize * 0.35, labelAlongX - fontSize * 0.85);
      ctx.fillText(text, sx, ty);
    }

    count = 0;
    for (let gy = startY; gy <= ymax + stepY * 0.5 && count < 48; gy += stepY) {
      count += 1;
      if (Math.abs(gy) < stepY * 1e-9) continue;
      const [, sy] = worldToScreen(xmin, gy);
      if (sy < edge + 4 || sy > height - edge - 4) continue;
      const text = formatTick(gy, stepY);
      const leftSide = labelAlongY < width * 0.5;
      if (leftSide) {
        ctx.textAlign = "left";
        ctx.fillText(text, Math.min(width - edge, labelAlongY + 5 * dpr), sy);
      } else {
        ctx.textAlign = "right";
        ctx.fillText(text, Math.max(edge, labelAlongY - 5 * dpr), sy);
      }
    }
    ctx.restore();
  }

  /** Radius labels for concentric polar rings. */
  function drawPolarRadii(ctx, {
    worldToScreen,
    cx,
    cy,
    radii,
    width,
    height,
    pixelScale = null,
  }) {
    const dpr = pixelScale == null ? (window.devicePixelRatio || 1) : pixelScale;
    const fontSize = Math.max(10, Math.round(11 * dpr));
    const edge = 8 * dpr;
    const step = radii.length > 1 ? Math.abs(radii[1] - radii[0]) : Math.abs(radii[0]) || 1;
    ctx.save();
    ctx.font = `${fontSize}px "IBM Plex Mono", "SF Mono", ui-monospace, Menlo, Consolas, monospace`;
    ctx.fillStyle = "rgba(198, 210, 240, 0.88)";
    ctx.textBaseline = "middle";

    for (const r of radii) {
      if (!(r > 0)) continue;
      // Prefer +x; fall back around the ring so a panned/zoomed view still gets labels.
      const candidates = [
        [cx + r, cy, "left"],
        [cx, cy + r, "center"],
        [cx - r, cy, "right"],
        [cx, cy - r, "center"],
        [cx + r * Math.SQRT1_2, cy + r * Math.SQRT1_2, "left"],
        [cx + r * Math.SQRT1_2, cy - r * Math.SQRT1_2, "left"],
      ];
      for (const [wx, wy, align] of candidates) {
        const [sx, sy] = worldToScreen(wx, wy);
        if (sx < edge || sx > width - edge || sy < edge || sy > height - edge) continue;
        ctx.textAlign = align;
        const pad = 5 * dpr;
        const tx = align === "left" ? sx + pad : align === "right" ? sx - pad : sx;
        ctx.fillText(formatTick(r, step), tx, sy);
        break;
      }
    }
    ctx.restore();
  }

  /** Angle marks around the polar origin (degrees). */
  function drawPolarAngles(ctx, {
    worldToScreen,
    cx,
    cy,
    radius,
    width,
    height,
    pixelScale = null,
  }) {
    if (!(radius > 0)) return;
    const dpr = pixelScale == null ? (window.devicePixelRatio || 1) : pixelScale;
    const fontSize = Math.max(9, Math.round(10 * dpr));
    const edge = 8 * dpr;
    const labelR = radius * 0.92;
    ctx.save();
    ctx.font = `${fontSize}px "IBM Plex Mono", "SF Mono", ui-monospace, Menlo, Consolas, monospace`;
    ctx.fillStyle = "rgba(168, 182, 220, 0.72)";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let deg = 0; deg < 360; deg += 30) {
      const th = (deg * Math.PI) / 180;
      const [sx, sy] = worldToScreen(cx + labelR * Math.cos(th), cy + labelR * Math.sin(th));
      if (sx < edge || sx > width - edge || sy < edge || sy > height - edge) continue;
      ctx.fillText(`${deg}°`, sx, sy);
    }
    ctx.restore();
  }

  window.GraphAxisLabels = {
    niceStep,
    formatTick,
    drawCartesian,
    drawPolarRadii,
    drawPolarAngles,
  };
})();
