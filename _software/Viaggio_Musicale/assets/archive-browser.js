"use strict";

const archive = window.LOCAL_ARCHIVE_INDEX || {
  periods: [],
  errors: [],
  stats: {}
};

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

const periodSelect = document.querySelector("#periodSelect");
const areaSelect = document.querySelector("#areaSelect");
const categorySelect = document.querySelector("#categorySelect");
const itemSelect = document.querySelector("#itemSelect");
const searchInput = document.querySelector("#documentSearch");
const results = document.querySelector("#archiveResults");
const profilePanel = document.querySelector("#centerMusicProfile");
const status = document.querySelector("#archiveStatus");
const stats = document.querySelector("#archiveStats");

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function option(value, label, selected = false) {
  return `<option value="${escapeHtml(value)}"${selected ? " selected" : ""}>${escapeHtml(label)}</option>`;
}

function selectedPeriod() {
  return archive.periods.find(period => period.id === periodSelect.value) || null;
}

function selectedArea() {
  return selectedPeriod()?.areas.find(area => area.id === areaSelect.value) || null;
}

function selectedCategory() {
  return selectedArea()?.categories.find(category => category.id === categorySelect.value) || null;
}

function selectedItem() {
  return selectedCategory()?.items.find(item => item.id === itemSelect.value) || null;
}

function selectedCenterProfile() {
  const item = selectedItem();
  const category = selectedCategory();

  if (!item || category?.id !== "centri_abitati") {
    return null;
  }

  const itemPath = String(item.relative_path || "")
    .replaceAll("/", "\\")
    .toLocaleLowerCase("it");

  return centerMusic.profiles.find(profile => {
    const profilePath = String(profile.center_relative_path || "")
      .replaceAll("/", "\\")
      .toLocaleLowerCase("it");

    return profilePath === itemPath;
  }) || null;
}

function statusLabel(statusValue) {
  const labels = {
    documentato: "Documentato",
    sintesi: "Sintesi",
    inferito: "Inferito",
    non_documentato: "Non documentato"
  };

  return labels[statusValue] || statusValue || "Non specificato";
}

function documentCard(document) {
  return `
    <article class="source-item">
      <div>
        <strong>${escapeHtml(document.name)}</strong>
        <span class="tag">${escapeHtml(document.extension || "file")}</span>
      </div>
      <p class="small">${escapeHtml(document.relative_path || "")}</p>
      ${
        document.file_url
          ? `<a class="button-link primary" href="${escapeHtml(document.file_url)}" target="_blank" rel="noopener">Apri documento</a>`
          : `<span class="small">Collegamento non disponibile</span>`
      }
    </article>
  `;
}

function profileDocumentCard(document) {
  return `
    <article class="profile-document">
      <div>
        <strong>${escapeHtml(document.label || document.document_id || "Documento")}</strong>
        <span class="tag">${escapeHtml(document.type || "file")}</span>
      </div>
      <p class="small">${escapeHtml(document.relative_path || document.path || "")}</p>
      ${
        document.exists && document.file_url
          ? `<a class="button-link" href="${escapeHtml(document.file_url)}" target="_blank" rel="noopener">Apri</a>`
          : document.blocked
            ? `<span class="profile-alert">Percorso esterno bloccato</span>`
            : `<span class="profile-alert">File non trovato</span>`
      }
    </article>
  `;
}

function linkCard(label, url, description) {
  if (!url) return "";

  return `
    <article class="source-item">
      <strong>${escapeHtml(label)}</strong>
      <p class="small">${escapeHtml(description || "")}</p>
      <a class="button-link" href="${escapeHtml(url)}" target="_blank" rel="noopener">Apri indice HTML</a>
    </article>
  `;
}

function renderCenterProfile() {
  const profile = selectedCenterProfile();

  if (!profile) {
    profilePanel.innerHTML = `
      <div class="empty">
        Seleziona un centro abitato dotato di musica-centro.json
        per visualizzare la scheda musicale.
      </div>
    `;
    return;
  }

  const counts = profile.counts || {};
  const scaleLinks = profile.scale_links || [];
  const traditionLinks = profile.tradition_links || [];

  profilePanel.innerHTML = `
    <article class="center-profile-card">
      <div class="center-profile-head">
        <div>
          <span class="small">${escapeHtml(profile.period?.id || "")} · ${escapeHtml(profile.area?.id || "")}</span>
          <h3>${escapeHtml(profile.center_label)}</h3>
        </div>
        <span class="status-badge status-${escapeHtml(profile.record_status)}">
          ${escapeHtml(statusLabel(profile.record_status))}
        </span>
      </div>

      <p>${escapeHtml(profile.documentation?.statement || "")}</p>
      <p class="small">${escapeHtml(profile.documentation?.absence_note || "")}</p>

      <div class="profile-count-grid">
        <div class="meta-box"><strong>Evidenze</strong><br>${counts.evidence ?? 0}</div>
        <div class="meta-box"><strong>Fonti</strong><br>${counts.sources ?? 0}</div>
        <div class="meta-box"><strong>Tradizioni</strong><br>${counts.traditions ?? 0}</div>
        <div class="meta-box"><strong>Scale</strong><br>${counts.scales ?? 0}</div>
        <div class="meta-box"><strong>Documenti</strong><br>${counts.documents ?? 0}</div>
      </div>

      <div class="profile-link-grid">
        <section>
          <h4>Tradizioni collegate</h4>
          ${
            traditionLinks.length
              ? traditionLinks.map(link => `
                  <div class="profile-link-item">
                    <strong>${escapeHtml(link.tradition_id)}</strong>
                    <span>${escapeHtml(statusLabel(link.relation_status))}</span>
                  </div>
                `).join("")
              : `<div class="empty compact-empty">Nessuna tradizione collegata.</div>`
          }
        </section>

        <section>
          <h4>Scale collegate</h4>
          ${
            scaleLinks.length
              ? scaleLinks.map(link => `
                  <div class="profile-link-item">
                    <strong>${escapeHtml(link.scale_id)}</strong>
                    <span>${escapeHtml(statusLabel(link.relation_status))}</span>
                  </div>
                `).join("")
              : `<div class="empty compact-empty">Nessuna scala collegata.</div>`
          }
        </section>
      </div>

      <h4>Documenti musicali del centro</h4>
      <div class="profile-document-list">
        ${(profile.documents || []).map(profileDocumentCard).join("") ||
          `<div class="empty compact-empty">Nessun documento musicale.</div>`}
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
        <button type="button" disabled title="Disponibile quando esiste almeno una scala collegata">
          Aggiungi al viaggio musicale
        </button>
      </div>

      ${
        scaleLinks.length === 0
          ? `<p class="small">Il pulsante per il viaggio resta disattivato finché non viene collegata una scala valida.</p>`
          : ""
      }
    </article>
  `;
}

function refreshAreas() {
  const period = selectedPeriod();

  areaSelect.innerHTML = `<option value="">Tutte le aree</option>` +
    (period?.areas || []).map(area => option(area.id, area.label)).join("");

  areaSelect.disabled = !period;
  refreshCategories();
}

function refreshCategories() {
  const area = selectedArea();

  categorySelect.innerHTML = `<option value="">Tutte le categorie</option>` +
    (area?.categories || []).map(category => option(category.id, category.label)).join("");

  categorySelect.disabled = !area;
  refreshItems();
}

function refreshItems() {
  const category = selectedCategory();

  itemSelect.innerHTML = `<option value="">Tutti gli elementi</option>` +
    (category?.items || []).map(item => option(item.id, item.label)).join("");

  itemSelect.disabled = !category;
  renderResults();
}

function collectDocuments() {
  const item = selectedItem();
  const category = selectedCategory();
  const area = selectedArea();
  const period = selectedPeriod();

  if (item) return [...(item.documents || [])];

  if (category) {
    return [
      ...(category.documents || []),
      ...(category.items || []).flatMap(entry => entry.documents || [])
    ];
  }

  if (area) {
    return [
      ...(area.documents || []),
      ...(area.categories || []).flatMap(cat => [
        ...(cat.documents || []),
        ...(cat.items || []).flatMap(entry => entry.documents || [])
      ])
    ];
  }

  if (period) {
    return [
      ...(period.documents || []),
      ...(period.areas || []).flatMap(a => [
        ...(a.documents || []),
        ...(a.categories || []).flatMap(cat => [
          ...(cat.documents || []),
          ...(cat.items || []).flatMap(entry => entry.documents || [])
        ])
      ])
    ];
  }

  return archive.periods.flatMap(p => [
    ...(p.documents || []),
    ...(p.areas || []).flatMap(a => [
      ...(a.documents || []),
      ...(a.categories || []).flatMap(cat => [
        ...(cat.documents || []),
        ...(cat.items || []).flatMap(entry => entry.documents || [])
      ])
    ])
  ]);
}

function renderResults() {
  const query = searchInput.value.trim().toLocaleLowerCase("it");
  const item = selectedItem();
  const category = selectedCategory();
  const area = selectedArea();
  const period = selectedPeriod();

  renderCenterProfile();

  const documents = collectDocuments()
    .filter(document => {
      if (!query) return true;

      return [
        document.name,
        document.label,
        document.relative_path
      ].some(value => String(value || "").toLocaleLowerCase("it").includes(query));
    })
    .sort((a, b) => String(a.relative_path).localeCompare(String(b.relative_path), "it"));

  const links = [
    linkCard(item?.label, item?.index_url, item?.relative_path),
    linkCard(category?.label, category?.index_url, category?.relative_path),
    linkCard(area?.label, area?.index_url, area?.relative_path),
    linkCard(period?.label, period?.index_url, period?.relative_path)
  ].filter(Boolean);

  const cards = [
    ...links,
    ...documents.map(documentCard)
  ];

  results.innerHTML = cards.length
    ? `<div class="source-list">${cards.join("")}</div>`
    : `<div class="empty">Nessun documento corrispondente ai filtri selezionati.</div>`;

  status.textContent =
    `${documents.length} documenti trovati; ` +
    `${centerMusic.stats?.profiles ?? 0} profili musicali indicizzati` +
    (query ? `; ricerca “${query}”` : "") +
    ".";
}

periodSelect.innerHTML =
  `<option value="">Tutti i periodi</option>` +
  archive.periods.map(period => option(period.id, period.label)).join("");

stats.innerHTML = `
  <div class="meta-box"><strong>Periodi</strong><br>${archive.stats?.periods ?? 0}</div>
  <div class="meta-box"><strong>Aree</strong><br>${archive.stats?.areas ?? 0}</div>
  <div class="meta-box"><strong>Elementi</strong><br>${archive.stats?.items ?? 0}</div>
  <div class="meta-box"><strong>Documenti</strong><br>${archive.stats?.documents ?? 0}</div>
  <div class="meta-box"><strong>Profili musicali</strong><br>${centerMusic.stats?.profiles ?? 0}</div>
  <div class="meta-box"><strong>Errori</strong><br>${(archive.stats?.errors ?? 0) + (centerMusic.stats?.errors ?? 0)}</div>
`;

periodSelect.addEventListener("change", refreshAreas);
areaSelect.addEventListener("change", refreshCategories);
categorySelect.addEventListener("change", refreshItems);
itemSelect.addEventListener("change", renderResults);
searchInput.addEventListener("input", renderResults);

refreshAreas();
