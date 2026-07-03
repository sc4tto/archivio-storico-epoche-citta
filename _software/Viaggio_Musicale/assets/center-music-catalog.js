"use strict";

const centerMusic = window.CENTER_MUSIC_INDEX || {
  profiles: [],
  errors: [],
  stats: {}
};

const theme =
  window.ARCHIVE_CATALOG?.theme ||
  window.DEFAULT_THEME ||
  {};

window.ThemeSystem.applyTheme(theme);

const periodFilter = document.querySelector("#catalogPeriod");
const areaFilter = document.querySelector("#catalogArea");
const statusFilter = document.querySelector("#catalogStatus");
const queryInput = document.querySelector("#catalogQuery");
const summary = document.querySelector("#catalogSummary");
const list = document.querySelector("#centerCatalogList");

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function statusLabel(value) {
  const labels = {
    documentato: "Documentato",
    sintesi: "Sintesi",
    inferito: "Inferito",
    non_documentato: "Non documentato"
  };

  return labels[value] || value || "Non specificato";
}

function uniqueValues(keySelector) {
  return [...new Map(
    centerMusic.profiles
      .map(keySelector)
      .filter(item => item?.id)
      .map(item => [item.id, item])
  ).values()];
}

const periods = uniqueValues(profile => profile.period)
  .sort((a, b) => Number(a.order || 999) - Number(b.order || 999));

const areas = uniqueValues(profile => profile.area)
  .sort((a, b) => String(a.label).localeCompare(String(b.label), "it"));

periodFilter.innerHTML =
  `<option value="">Tutti i periodi</option>` +
  periods.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.id)} · ${escapeHtml(item.label)}</option>`).join("");

areaFilter.innerHTML =
  `<option value="">Tutte le aree</option>` +
  areas.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.label)}</option>`).join("");

function render() {
  const period = periodFilter.value;
  const area = areaFilter.value;
  const recordStatus = statusFilter.value;
  const query = queryInput.value.trim().toLocaleLowerCase("it");

  const filtered = centerMusic.profiles
    .filter(profile => !period || profile.period?.id === period)
    .filter(profile => !area || profile.area?.id === area)
    .filter(profile => !recordStatus || profile.record_status === recordStatus)
    .filter(profile => {
      if (!query) return true;

      return [
        profile.center_label,
        profile.profile_id,
        profile.area?.label,
        profile.period?.label,
        profile.documentation?.statement
      ].some(value => String(value || "").toLocaleLowerCase("it").includes(query));
    })
    .sort((a, b) => {
      const periodOrder = Number(a.period?.order || 999) - Number(b.period?.order || 999);
      if (periodOrder !== 0) return periodOrder;

      const areaOrder = String(a.area?.label || "").localeCompare(String(b.area?.label || ""), "it");
      if (areaOrder !== 0) return areaOrder;

      return String(a.center_label || "").localeCompare(String(b.center_label || ""), "it");
    });

  summary.innerHTML = `
    <div class="meta-box"><strong>Profili visualizzati</strong><br>${filtered.length}</div>
    <div class="meta-box"><strong>Profili complessivi</strong><br>${centerMusic.stats?.profiles ?? 0}</div>
    <div class="meta-box"><strong>Documentati</strong><br>${centerMusic.stats?.statuses?.documentato ?? 0}</div>
    <div class="meta-box"><strong>Non documentati</strong><br>${centerMusic.stats?.statuses?.non_documentato ?? 0}</div>
    <div class="meta-box"><strong>Errori</strong><br>${centerMusic.stats?.errors ?? 0}</div>
  `;

  if (!filtered.length) {
    list.innerHTML = `<div class="empty">Nessun profilo corrispondente ai filtri.</div>`;
    return;
  }

  list.innerHTML = filtered.map(profile => `
    <article class="catalog-center-card">
      <div class="center-profile-head">
        <div>
          <span class="small">${escapeHtml(profile.period?.id)} · ${escapeHtml(profile.area?.label)}</span>
          <h3>${escapeHtml(profile.center_label)}</h3>
        </div>
        <span class="status-badge status-${escapeHtml(profile.record_status)}">
          ${escapeHtml(statusLabel(profile.record_status))}
        </span>
      </div>

      <p>${escapeHtml(profile.documentation?.statement || "")}</p>

      <div class="profile-count-grid">
        <div class="meta-box"><strong>Evidenze</strong><br>${profile.counts?.evidence ?? 0}</div>
        <div class="meta-box"><strong>Fonti</strong><br>${profile.counts?.sources ?? 0}</div>
        <div class="meta-box"><strong>Tradizioni</strong><br>${profile.counts?.traditions ?? 0}</div>
        <div class="meta-box"><strong>Scale</strong><br>${profile.counts?.scales ?? 0}</div>
      </div>

      <div class="toolbar profile-toolbar">
        ${
          profile.profile_file_url
            ? `<a class="button-link" href="${escapeHtml(profile.profile_file_url)}" target="_blank" rel="noopener">Apri JSON</a>`
            : ""
        }
        ${
          profile.center_directory_url
            ? `<a class="button-link" href="${escapeHtml(profile.center_directory_url)}" target="_blank" rel="noopener">Apri cartella</a>`
            : ""
        }
      </div>
    </article>
  `).join("");
}

periodFilter.addEventListener("change", render);
areaFilter.addEventListener("change", render);
statusFilter.addEventListener("change", render);
queryInput.addEventListener("input", render);

render();
