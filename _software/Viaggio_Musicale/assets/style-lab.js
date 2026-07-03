"use strict";

const theme =
  window.ARCHIVE_CATALOG?.theme ||
  window.DEFAULT_THEME ||
  {};

const appliedTheme = window.ThemeSystem.applyTheme(theme);

document.querySelectorAll(".sample-node").forEach(node => {
  node.style.setProperty(
    "--node-color",
    window.ThemeSystem.areaColor(appliedTheme, node.dataset.area)
  );
});

const labels = {
  ASW: "Asia sud-occidentale",
  EUR_MED: "Mediterraneo europeo",
  SA: "Asia meridionale",
  NEA: "Valle del Nilo e Africa nord-orientale",
  EA: "Asia orientale",
  SEA: "Asia sud-orientale",
  AFR_SUB: "Africa subsahariana",
  MESO: "Mesoamerica",
  ANDES: "Ande centrali",
  N_AMERICA: "America settentrionale",
  OCEANIA: "Oceania e Pacifico"
};

const swatches = document.querySelector("#areaSwatches");

for (const [id, color] of Object.entries(appliedTheme.areas || {})) {
  const item = document.createElement("div");
  item.className = "swatch";
  item.style.setProperty("--swatch", color);
  item.innerHTML = `
    <strong>${labels[id] || id}</strong>
    <span>${id} · ${color}</span>
  `;
  swatches.appendChild(item);
}
