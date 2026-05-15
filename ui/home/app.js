function $(id) {
  return document.getElementById(id);
}

async function bootstrap() {
  VizTransition.initPageTransition();

  const grid = $("visualizerGrid");
  const items = await window.pywebview.api.get_visualizers();

  items.forEach((viz) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "viz-card glass";
    card.innerHTML = `
      <span class="viz-card-symbol">${viz.symbol}</span>
      <h2 class="viz-card-title">${viz.title}</h2>
      <p class="viz-card-subtitle">${viz.subtitle}</p>
      <span class="viz-card-action">Open visualizer →</span>
    `;
    card.addEventListener("click", async () => {
      await VizTransition.navigateWithWoosh(VizTransition.forward, () => {
        window.pywebview.api.open_visualizer(viz.id);
      });
    });
    grid.appendChild(card);
  });
}

whenApiReady(bootstrap);
