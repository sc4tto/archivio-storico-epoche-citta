"use strict";

function asArray(value) {
  if (Array.isArray(value)) {
    return value;
  }

  if (value === null || value === undefined) {
    return [];
  }

  return [value];
}

const rawCatalog = window.ARCHIVE_CATALOG || {
  containers: [],
  stats: {},
  errors: []
};

const catalog = {
  ...rawCatalog,
  containers: asArray(rawCatalog.containers)
    .filter(Boolean)
    .map(container => ({
      ...container,
      documents: asArray(container.documents),
      sources: asArray(container.sources),
      scales: asArray(container.scales)
        .filter(Boolean)
        .map(scale => ({
          ...scale,
          notes_12tet: asArray(scale.notes_12tet),
          pitch_classes_12tet: asArray(scale.pitch_classes_12tet),
          source_ids: asArray(scale.source_ids),
          documents: asArray(scale.documents),
          historical_tuning: scale.historical_tuning
            ? {
                ...scale.historical_tuning,
                source_ids: asArray(
                  scale.historical_tuning.source_ids
                ),
                measured_natural_sequence: asArray(
                  scale.historical_tuning.measured_natural_sequence
                ),
                measured_intervals_cents: asArray(
                  scale.historical_tuning.measured_intervals_cents
                ),
                scale_degrees_from_keynote: asArray(
                  scale.historical_tuning.scale_degrees_from_keynote
                )
              }
            : scale.historical_tuning
        }))
    })),
  errors: asArray(rawCatalog.errors)
};

const rawCenterIndex = window.CENTER_MUSIC_INDEX || {
  profiles: [],
  stats: {},
  errors: []
};

const centerIndex = {
  ...rawCenterIndex,
  profiles: asArray(rawCenterIndex.profiles)
    .filter(Boolean)
    .map(profile => ({
      ...profile,
      musical_evidence: asArray(profile.musical_evidence),
      tradition_links: asArray(profile.tradition_links)
        .filter(Boolean)
        .map(link => ({
          ...link,
          source_ids: asArray(link.source_ids)
        })),
      scale_links: asArray(profile.scale_links)
        .filter(Boolean)
        .map(link => ({
          ...link,
          source_ids: asArray(link.source_ids)
        })),
      documents: asArray(profile.documents),
      sources: asArray(profile.sources)
    })),
  rejected: asArray(rawCenterIndex.rejected),
  errors: asArray(rawCenterIndex.errors),
  container_errors: asArray(rawCenterIndex.container_errors)
};

const theme =
  catalog.theme ||
  window.DEFAULT_THEME ||
  {};

const appliedTheme = window.ThemeSystem.applyTheme(theme);

const selectionPolicy =
  window.SELECTION_POLICY || {
    schema_version: 1,
    default_mode: "verified",
    verified_relation_statuses: ["documentato"],
    require_documented_tradition_link: true,
    require_documented_scale_link: true,
    require_resolved_scale: true,
    laboratory_mode_available: true,
    empty_message:
      "Nessuna combinazione centro-tradizione-scala documentata è disponibile."
  };

const requestedMode =
  new URLSearchParams(window.location.search).get("mode");

const isLaboratoryMode =
  requestedMode === "laboratory" &&
  selectionPolicy.laboratory_mode_available !== false;

const verifiedStatuses = new Set(
  selectionPolicy.verified_relation_statuses || ["documentato"]
);

function isVerifiedStatus(value) {
  return verifiedStatuses.has(String(value || ""));
}

const ui = {
  canvas: document.querySelector("#journeyCanvas"),
  results: document.querySelector("#journeyResults"),
  status: document.querySelector("#journeyStatus"),
  modeBanner: document.querySelector("#selectionModeBanner"),
  verifiedModeLink: document.querySelector("#verifiedModeLink"),
  laboratoryModeLink: document.querySelector("#laboratoryModeLink"),
  addNode: document.querySelector("#addNode"),
  loadExample: document.querySelector("#loadExample"),
  resetJourney: document.querySelector("#resetJourney"),
  calculateJourney: document.querySelector("#calculateJourney"),
  exportJourney: document.querySelector("#exportJourney")
};

const state = {
  nodes: [],
  nextId: 1,
  maxNodes: 8,
  labMode: isLaboratoryMode
};

const pitchClassNames = [
  "Do",
  "Do♯/Re♭",
  "Re",
  "Re♯/Mi♭",
  "Mi",
  "Fa",
  "Fa♯/Sol♭",
  "Sol",
  "Sol♯/La♭",
  "La",
  "La♯/Si♭",
  "Si"
];

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function uniqueBy(items, selector) {
  return [...new Map(
    items.map(item => [selector(item), item])
  ).values()];
}

function labelForNode(index) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  return alphabet[index] || String(index + 1);
}

function createEmptyNode() {
  return {
    id: state.nextId++,
    areaId: "",
    periodId: "",
    profileId: "",
    containerId: "",
    scaleId: ""
  };
}

function profileById(profileId) {
  return centerIndex.profiles.find(
    profile => profile.profile_id === profileId
  ) || null;
}

function containerById(containerId) {
  return catalog.containers.find(
    container => container.container_id === containerId
  ) || null;
}

function scaleForNode(node) {
  const container = containerById(node.containerId);

  return container?.scales?.find(
    scale => scale.scale_id === node.scaleId
  ) || null;
}

function documentedScaleLinks(profile) {
  return (profile?.scale_links || []).filter(link =>
    isVerifiedStatus(link.relation_status)
  );
}

function documentedTraditionLinks(profile) {
  return (profile?.tradition_links || []).filter(link =>
    isVerifiedStatus(link.relation_status)
  );
}

function documentedScaleIds(profile) {
  return new Set(
    documentedScaleLinks(profile)
      .map(link => link.scale_id)
      .filter(Boolean)
  );
}

function documentedTraditionIds(profile) {
  return new Set(
    documentedTraditionLinks(profile)
      .map(link => link.tradition_id)
      .filter(Boolean)
  );
}

function linkedScaleIds(profile) {
  const links = state.labMode
    ? (profile?.scale_links || [])
    : documentedScaleLinks(profile);

  return new Set(
    links.map(link => link.scale_id).filter(Boolean)
  );
}

function linkedTraditionIds(profile) {
  const links = state.labMode
    ? (profile?.tradition_links || [])
    : documentedTraditionLinks(profile);

  return new Set(
    links.map(link => link.tradition_id).filter(Boolean)
  );
}

function containerHasDocumentedChain(profile, container) {
  if (!profile || !container) {
    return false;
  }

  const scaleIds = documentedScaleIds(profile);
  const traditionIds = documentedTraditionIds(profile);
  const hasTradition =
    traditionIds.has(container.tradition?.id);
  const hasScale = (container.scales || []).some(
    scale => scaleIds.has(scale.scale_id)
  );

  if (
    selectionPolicy.require_documented_tradition_link !== false &&
    !hasTradition
  ) {
    return false;
  }

  if (
    selectionPolicy.require_documented_scale_link !== false &&
    !hasScale
  ) {
    return false;
  }

  return hasTradition || hasScale;
}

function profileHasDocumentedChain(profile) {
  return catalog.containers.some(
    container => containerHasDocumentedChain(profile, container)
  );
}

function selectableProfiles() {
  return state.labMode
    ? [...centerIndex.profiles]
    : centerIndex.profiles.filter(profileHasDocumentedChain);
}

function areas() {
  return uniqueBy(
    selectableProfiles()
      .map(profile => profile.area)
      .filter(area => area?.id),
    area => area.id
  ).sort((a, b) =>
    String(a.label).localeCompare(String(b.label), "it")
  );
}

function periodsForArea(areaId) {
  return uniqueBy(
    selectableProfiles()
      .filter(profile => profile.area?.id === areaId)
      .map(profile => profile.period)
      .filter(period => period?.id),
    period => period.id
  ).sort((a, b) =>
    Number(a.order || 999) - Number(b.order || 999)
  );
}

function profilesForNode(node) {
  return selectableProfiles()
    .filter(profile =>
      (!node.areaId || profile.area?.id === node.areaId) &&
      (!node.periodId || profile.period?.id === node.periodId)
    )
    .sort((a, b) =>
      String(a.center_label).localeCompare(
        String(b.center_label),
        "it"
      )
    );
}

function containersForNode(node) {
  const profile = profileById(node.profileId);

  if (!profile) {
    return [];
  }

  if (state.labMode) {
    return catalog.containers
      .filter(container => container.area?.id === node.areaId)
      .sort((a, b) => {
        const periodOrder =
          Number(a.period?.order || 999) -
          Number(b.period?.order || 999);

        if (periodOrder !== 0) {
          return periodOrder;
        }

        return String(a.tradition?.label || "").localeCompare(
          String(b.tradition?.label || ""),
          "it"
        );
      });
  }

  return catalog.containers
    .filter(container =>
      containerHasDocumentedChain(profile, container)
    )
    .sort((a, b) =>
      String(a.tradition?.label || "").localeCompare(
        String(b.tradition?.label || ""),
        "it"
      )
    );
}

function scalesForNode(node) {
  const profile = profileById(node.profileId);
  const container = containerById(node.containerId);

  if (!profile || !container) {
    return [];
  }

  if (state.labMode) {
    return container.scales || [];
  }

  const scaleIds = documentedScaleIds(profile);

  return (container.scales || []).filter(
    scale => scaleIds.has(scale.scale_id)
  );
}

function relationForNode(node) {
  const profile = profileById(node.profileId);
  const container = containerById(node.containerId);
  const scale = scaleForNode(node);

  if (!profile || !container || !scale) {
    return null;
  }

  const scaleLink = (profile.scale_links || []).find(
    item =>
      item.scale_id === scale.scale_id &&
      isVerifiedStatus(item.relation_status)
  );

  const traditionLink = (profile.tradition_links || []).find(
    item =>
      item.tradition_id === container.tradition?.id &&
      isVerifiedStatus(item.relation_status)
  );

  if (scaleLink && traditionLink) {
    return {
      kind: "linked",
      status: "documentato",
      label:
        "Collegamento documentato centro → tradizione → scala"
    };
  }

  return {
    kind: "laboratory",
    status: "laboratorio",
    label: "Associazione dimostrativa non storica"
  };
}

function option(value, label, selected = false) {
  return `
    <option value="${escapeHtml(value)}"${selected ? " selected" : ""}>
      ${escapeHtml(label)}
    </option>
  `;
}

function normalizeNode(node) {
  const availablePeriods = periodsForArea(node.areaId);

  if (!availablePeriods.some(period => period.id === node.periodId)) {
    node.periodId = "";
    node.profileId = "";
    node.containerId = "";
    node.scaleId = "";
  }

  const availableProfiles = profilesForNode(node);

  if (!availableProfiles.some(profile => profile.profile_id === node.profileId)) {
    node.profileId = "";
    node.containerId = "";
    node.scaleId = "";
  }

  const availableContainers = containersForNode(node);

  if (!availableContainers.some(container => container.container_id === node.containerId)) {
    node.containerId = "";
    node.scaleId = "";
  }

  const availableScales = scalesForNode(node);

  if (!availableScales.some(scale => scale.scale_id === node.scaleId)) {
    node.scaleId = "";
  }
}

function setNodeField(nodeId, field, value) {
  const node = state.nodes.find(item => item.id === nodeId);

  if (!node) {
    return;
  }

  node[field] = value;

  const resetOrder = {
    areaId: ["periodId", "profileId", "containerId", "scaleId"],
    periodId: ["profileId", "containerId", "scaleId"],
    profileId: ["containerId", "scaleId"],
    containerId: ["scaleId"]
  };

  for (const key of resetOrder[field] || []) {
    node[key] = "";
  }

  normalizeNode(node);
  render();
}

function classifyTriad(rootPc, thirdPc, fifthPc) {
  const third = (thirdPc - rootPc + 12) % 12;
  const fifth = (fifthPc - rootPc + 12) % 12;

  if (third === 4 && fifth === 7) {
    return { label: "maggiore", suffix: "" };
  }

  if (third === 3 && fifth === 7) {
    return { label: "minore", suffix: "m" };
  }

  if (third === 3 && fifth === 6) {
    return { label: "diminuito", suffix: "°" };
  }

  if (third === 4 && fifth === 8) {
    return { label: "aumentato", suffix: "+" };
  }

  if (third === 2 && fifth === 7) {
    return { label: "sospeso 2", suffix: "sus2" };
  }

  if (third === 5 && fifth === 7) {
    return { label: "sospeso 4", suffix: "sus4" };
  }

  return {
    label: `intervalli ${third}-${fifth}`,
    suffix: `(${third}-${fifth})`
  };
}

function harmonizeScale(scale) {
  const notes = scale?.notes_12tet || [];
  const pcs = scale?.pitch_classes_12tet || [];

  if (notes.length < 5 || pcs.length !== notes.length) {
    return [];
  }

  return pcs.map((rootPc, index) => {
    const thirdIndex = (index + 2) % pcs.length;
    const fifthIndex = (index + 4) % pcs.length;
    const quality = classifyTriad(
      Number(rootPc),
      Number(pcs[thirdIndex]),
      Number(pcs[fifthIndex])
    );

    const chordPcs = [
      Number(rootPc),
      Number(pcs[thirdIndex]),
      Number(pcs[fifthIndex])
    ];

    return {
      degree: index + 1,
      root: notes[index],
      name: `${notes[index]}${quality.suffix}`,
      quality: quality.label,
      notes: [
        notes[index],
        notes[thirdIndex],
        notes[fifthIndex]
      ],
      pcs: chordPcs,
      key: [...chordPcs].sort((a, b) => a - b).join("-")
    };
  });
}

function nodeDocuments(profile, container, scale) {
  return [
    ...(profile?.documents || []).map(document => ({
      label: document.label,
      url: document.file_url,
      exists: document.exists
    })),
    ...(container?.documents || []).map(document => ({
      label: document.label,
      url: document._file_url,
      exists: document._exists
    })),
    ...(scale?.documents || []).map(document => ({
      label: document.label,
      url: document._file_url,
      exists: document._exists
    }))
  ];
}


function documentationStatusClass(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-");

  return normalized || "non-specificato";
}

function renderSourceIds(sourceIds) {
  const ids = asArray(sourceIds).filter(Boolean);

  if (!ids.length) {
    return `<span class="small">Nessun source_id registrato</span>`;
  }

  return ids
    .map(id => `<code>${escapeHtml(id)}</code>`)
    .join(" ");
}

function renderEvidencePanel(profile) {
  const evidence = asArray(profile?.musical_evidence);

  if (!evidence.length) {
    return `
      <div class="documentation-empty">
        Nessuna evidenza strutturata registrata.
      </div>
    `;
  }

  return `
    <div class="evidence-list">
      ${evidence.map(item => `
        <article class="evidence-item">
          <div class="documentation-heading">
            <strong>${escapeHtml(item.type || "evidenza")}</strong>
            <span class="documentation-badge status-${documentationStatusClass(item.status)}">
              ${escapeHtml(item.status || "non specificato")}
            </span>
          </div>

          <p>${escapeHtml(item.statement || "")}</p>

          <div class="source-id-row">
            ${renderSourceIds(item.source_ids)}
          </div>
        </article>
      `).join("")}
    </div>
  `;
}

function renderHistoricalTuning(scale) {
  const tuning = scale?.historical_tuning;

  if (!tuning) {
    return `
      <div class="documentation-empty">
        Nessuna descrizione storico-acustica disponibile.
      </div>
    `;
  }

  const sequence = asArray(tuning.measured_natural_sequence);
  const intervals = asArray(tuning.measured_intervals_cents);
  const degrees = asArray(tuning.scale_degrees_from_keynote);

  return `
    <div class="historical-data-panel">
      <p>${escapeHtml(tuning.description || "")}</p>

      ${
        tuning.keynote
          ? `
            <dl class="documentation-grid compact-grid">
              <div>
                <dt>Centro storico-acustico</dt>
                <dd>${escapeHtml(tuning.keynote.modern_equivalent || "—")}</dd>
              </div>
              <div>
                <dt>Scarto</dt>
                <dd>
                  ${
                    tuning.keynote.deviation_cents === null ||
                    tuning.keynote.deviation_cents === undefined
                      ? "—"
                      : `${escapeHtml(tuning.keynote.deviation_cents)} cent`
                  }
                </dd>
              </div>
              <div>
                <dt>Posizione</dt>
                <dd>${escapeHtml(tuning.keynote.position || "—")}</dd>
              </div>
            </dl>
          `
          : ""
      }

      ${
        sequence.length
          ? `
            <div class="documentation-table-shell">
              <table class="documentation-table">
                <thead>
                  <tr>
                    <th>Posizione</th>
                    <th>Equivalente moderno</th>
                    <th>Scarto</th>
                    <th>Grado</th>
                  </tr>
                </thead>
                <tbody>
                  ${sequence.map(item => `
                    <tr>
                      <td>${escapeHtml(item.position || "—")}</td>
                      <td>${escapeHtml(item.modern_equivalent || "—")}</td>
                      <td>
                        ${
                          item.deviation_cents === null ||
                          item.deviation_cents === undefined
                            ? "—"
                            : `${escapeHtml(item.deviation_cents)} cent`
                        }
                      </td>
                      <td>${escapeHtml(item.scale_degree || "—")}</td>
                    </tr>
                  `).join("")}
                </tbody>
              </table>
            </div>
          `
          : ""
      }

      ${
        intervals.length
          ? `
            <p>
              <strong>Intervalli misurati:</strong>
              ${escapeHtml(intervals.join(" · "))} cent
            </p>
          `
          : ""
      }

      ${
        degrees.length
          ? `
            <p>
              <strong>Gradi dalla nota centrale:</strong>
              ${escapeHtml(degrees.join(" – "))}
            </p>
          `
          : ""
      }

      <div class="source-id-row">
        <strong>Fonti del sistema storico:</strong>
        ${renderSourceIds(tuning.source_ids)}
      </div>
    </div>
  `;
}

function renderSourcesPanel(profile, container) {
  const sourceMap = new Map();

  [
    ...asArray(container?.sources),
    ...asArray(profile?.sources)
  ].forEach(source => {
    if (!source) {
      return;
    }

    const key = source.source_id || JSON.stringify(source);
    sourceMap.set(key, source);
  });

  const sources = [...sourceMap.values()];

  if (!sources.length) {
    return `
      <div class="documentation-empty">
        Nessuna fonte strutturata registrata.
      </div>
    `;
  }

  return `
    <div class="source-list">
      ${sources.map(source => `
        <article class="source-item">
          <div class="documentation-heading">
            <strong>${escapeHtml(source.title || source.source_id || "Fonte")}</strong>
            <span class="source-grade">
              Classe ${escapeHtml(source.grade || "—")}
            </span>
          </div>

          <p class="small">
            ${escapeHtml(source.author || "Autore non indicato")}
            ${
              source.year
                ? ` · ${escapeHtml(source.year)}`
                : ""
            }
          </p>

          ${
            source.publisher_or_journal
              ? `<p>${escapeHtml(source.publisher_or_journal)}</p>`
              : ""
          }

          <dl class="documentation-grid compact-grid">
            <div>
              <dt>Source ID</dt>
              <dd><code>${escapeHtml(source.source_id || "—")}</code></dd>
            </div>
            <div>
              <dt>Identificatore</dt>
              <dd>${escapeHtml(source.identifier || "—")}</dd>
            </div>
            <div>
              <dt>Pagine</dt>
              <dd>${escapeHtml(source.pages || "—")}</dd>
            </div>
            <div>
              <dt>Funzione</dt>
              <dd>${escapeHtml(source.purpose || "—")}</dd>
            </div>
          </dl>
        </article>
      `).join("")}
    </div>
  `;
}

function renderDocumentationSummary(profile, container, scale, relation) {
  const documentation = profile?.documentation || {};
  const review = profile?.review || {};

  return `
    <div class="documentation-levels">
      <div class="documentation-level historical-level">
        <strong>1. Dato storico documentato</strong>
        <span>
          Misure, reperti, fonti e collegamenti registrati nel profilo.
        </span>
      </div>

      <div class="documentation-level approximation-level">
        <strong>2. Approssimazione 12-TET</strong>
        <span>
          ${escapeHtml(scale.approximation?.warning || "Riduzione moderna per il confronto.")}
        </span>
      </div>

      <div class="documentation-level harmonization-level">
        <strong>3. Armonizzazione moderna proposta</strong>
        <span>
          ${
            escapeHtml(
              scale.harmonization?.warning ||
              "Gli accordi calcolati non costituiscono una pratica storica attestata."
            )
          }
        </span>
      </div>
    </div>

    <dl class="documentation-grid">
      <div>
        <dt>Relazione selezionata</dt>
        <dd>${escapeHtml(relation?.label || "—")}</dd>
      </div>
      <div>
        <dt>Stato del profilo</dt>
        <dd>
          <span class="documentation-badge status-${documentationStatusClass(profile.record_status)}">
            ${escapeHtml(profile.record_status || "—")}
          </span>
        </dd>
      </div>
      <div>
        <dt>Compatibilità cronologica</dt>
        <dd>
          ${escapeHtml(documentation.chronology_status || "—")}
          ${
            documentation.chronology_statement
              ? `<br><span class="small">${escapeHtml(documentation.chronology_statement)}</span>`
              : ""
          }
        </dd>
      </div>
      <div>
        <dt>Compatibilità geografica</dt>
        <dd>
          ${escapeHtml(documentation.geography_status || "—")}
          ${
            documentation.geography_relation
              ? ` · ${escapeHtml(documentation.geography_relation)}`
              : ""
          }
          ${
            documentation.geography_statement
              ? `<br><span class="small">${escapeHtml(documentation.geography_statement)}</span>`
              : ""
          }
        </dd>
      </div>
      <div>
        <dt>Livello di fiducia</dt>
        <dd>${escapeHtml(documentation.confidence || "—")}</dd>
      </div>
      <div>
        <dt>Revisione</dt>
        <dd>
          ${escapeHtml(review.status || "—")}
          ${
            review.reviewer
              ? `<br><span class="small">${escapeHtml(review.reviewer)}</span>`
              : ""
          }
        </dd>
      </div>
    </dl>

    ${
      documentation.limitation_note
        ? `
          <div class="documentation-warning">
            <strong>Limiti dichiarati</strong>
            <p>${escapeHtml(documentation.limitation_note)}</p>
          </div>
        `
        : ""
    }

    ${
      review.next_action
        ? `
          <div class="documentation-next-action">
            <strong>Prossima revisione</strong>
            <p>${escapeHtml(review.next_action)}</p>
          </div>
        `
        : ""
    }
  `;
}

function renderNodeDetails(node) {
  const profile = profileById(node.profileId);
  const container = containerById(node.containerId);
  const scale = scaleForNode(node);

  if (!profile) {
    return `
      <div class="scale-summary">
        <span class="small">
          Seleziona area, periodo e centro per vedere le opzioni musicali.
        </span>
      </div>
    `;
  }

  if (!scale) {
    const available = containersForNode(node).length;

    return `
      <div class="scale-summary">
        <strong>${escapeHtml(profile.center_label)}</strong><br>
        Stato del profilo:
        <span class="documentation-badge status-${documentationStatusClass(profile.record_status)}">
          ${escapeHtml(profile.record_status || "non specificato")}
        </span><br>

        <span class="small">
          ${
            available
              ? "Seleziona una tradizione e una scala documentate."
              : state.labMode
                ? "Nessun contenitore demo disponibile per questa area."
                : "Nessuna catena documentata centro → tradizione → scala."
          }
        </span>
      </div>
    `;
  }

  const relation = relationForNode(node);
  const harmony = harmonizeScale(scale);
  const documents = nodeDocuments(profile, container, scale)
    .filter(document => document.exists !== false);
  const periodMismatch =
    profile.period?.id !== container.period?.id;

  return `
    <div class="scale-summary center-scale-summary">
      <div class="scale-title-row">
        <div>
          <strong>${escapeHtml(scale.name)}</strong><br>
          <span class="small">
            ${escapeHtml(container.tradition?.label || "")}
          </span>
        </div>

        <span class="documentation-badge status-${documentationStatusClass(scale.documentation_status)}">
          ${escapeHtml(scale.documentation_status || "non specificato")}
        </span>
      </div>

      <dl class="documentation-grid compact-grid scale-overview-grid">
        <div>
          <dt>Centro musicale</dt>
          <dd>
            ${escapeHtml(scale.center?.label || "—")}
            · ${escapeHtml(scale.center?.type || "—")}
          </dd>
        </div>
        <div>
          <dt>Note 12-TET</dt>
          <dd>${escapeHtml(asArray(scale.notes_12tet).join(" – ") || "—")}</dd>
        </div>
        <div>
          <dt>Pitch class</dt>
          <dd>${escapeHtml(asArray(scale.pitch_classes_12tet).join(" – ") || "—")}</dd>
        </div>
        <div>
          <dt>Periodo dei dati</dt>
          <dd>${escapeHtml(container.period?.id || "—")}</dd>
        </div>
      </dl>

      <div class="relation-banner relation-${escapeHtml(relation?.kind || "unknown")}">
        ${escapeHtml(relation?.label || "")}

        ${
          periodMismatch
            ? `
              <br>
              <span>
                Centro ${escapeHtml(profile.period?.id)}
                · dati della scala ${escapeHtml(container.period?.id)}
              </span>
            `
            : ""
        }
      </div>

      <details class="node-analysis documentation-analysis" open>
        <summary>Scheda documentale</summary>

        <div class="node-analysis-body">
          ${renderDocumentationSummary(profile, container, scale, relation)}

          <h4>Evidenze registrate</h4>
          ${renderEvidencePanel(profile)}

          <h4>Dati storico-acustici</h4>
          ${renderHistoricalTuning(scale)}

          <h4>Fonti</h4>
          ${renderSourcesPanel(profile, container)}

          ${
            documents.length
              ? `
                <h4>Documenti locali</h4>
                <div class="node-document-links">
                  ${documents.map(document =>
                    document.url
                      ? `
                        <a
                          class="button-link"
                          href="${escapeHtml(document.url)}"
                          target="_blank"
                          rel="noopener"
                        >
                          ${escapeHtml(document.label || "Apri")}
                        </a>
                      `
                      : ""
                  ).join("")}
                </div>
              `
              : ""
          }
        </div>
      </details>

      <details class="node-analysis">
        <summary>Scala e armonizzazione moderna</summary>

        <div class="node-analysis-body">
          <h4>Approssimazione operativa</h4>

          <p>
            Sistema:
            ${escapeHtml(scale.approximation?.system || "12-TET")}
            · qualità:
            ${escapeHtml(scale.approximation?.quality || "non specificata")}
          </p>

          <p class="small">
            ${escapeHtml(scale.approximation?.warning || "")}
          </p>

          <h4>Armonizzazione occidentale proposta</h4>

          <p class="small">
            Questa armonizzazione è calcolata impilando terze nella
            rappresentazione 12-TET. Non descrive automaticamente
            l’armonia storica della tradizione.
          </p>

          <div class="harmony-grid">
            ${harmony.map(chord => `
              <div class="harmony-chord">
                <strong>
                  ${escapeHtml(chord.degree)}.
                  ${escapeHtml(chord.name)}
                </strong>
                <span>${escapeHtml(chord.quality)}</span>
                <span>${escapeHtml(chord.notes.join(" – "))}</span>
              </div>
            `).join("")}
          </div>
        </div>
      </details>
    </div>
  `;
}

function renderNode(node, index) {
  normalizeNode(node);

  const periodOptions = periodsForArea(node.areaId);
  const profileOptions = profilesForNode(node);
  const containerOptions = containersForNode(node);
  const scaleOptions = scalesForNode(node);
  const profile = profileById(node.profileId);
  const color = window.ThemeSystem.areaColor(
    appliedTheme,
    node.areaId
  );

  return `
    <article
      class="stop-node center-stop-node"
      data-node-id="${node.id}"
      style="--node-color:${escapeHtml(color)}"
    >
      <div class="node-head">
        <div class="node-title-group">
          <span class="node-index">${escapeHtml(labelForNode(index))}</span>
          <div>
            <span class="small">Tappa ${index + 1}</span>
            <h3>${escapeHtml(profile?.center_label || "Nuova tappa")}</h3>
          </div>
        </div>

        ${
          state.nodes.length > 2
            ? `<button class="icon-button remove-node" data-node-id="${node.id}" type="button" title="Rimuovi tappa">×</button>`
            : ""
        }
      </div>

      <div class="field">
        <label>1. Area geografica</label>
        <select data-node-id="${node.id}" data-field="areaId">
          <option value="">Seleziona area</option>
          ${areas().map(area =>
            option(area.id, area.label, area.id === node.areaId)
          ).join("")}
        </select>
      </div>

      <div class="field">
        <label>2. Periodo storico</label>
        <select
          data-node-id="${node.id}"
          data-field="periodId"
          ${node.areaId ? "" : "disabled"}
        >
          <option value="">Seleziona periodo</option>
          ${periodOptions.map(period =>
            option(
              period.id,
              `${period.id} · ${period.label}`,
              period.id === node.periodId
            )
          ).join("")}
        </select>
      </div>

      <div class="field">
        <label>3. Centro abitato</label>
        <select
          data-node-id="${node.id}"
          data-field="profileId"
          ${node.periodId ? "" : "disabled"}
        >
          <option value="">Seleziona centro</option>
          ${profileOptions.map(item =>
            option(
              item.profile_id,
              item.center_label,
              item.profile_id === node.profileId
            )
          ).join("")}
        </select>
      </div>

      <div class="field">
        <label>4. Tradizione musicale</label>
        <select
          data-node-id="${node.id}"
          data-field="containerId"
          ${node.profileId ? "" : "disabled"}
        >
          <option value="">Seleziona tradizione</option>
          ${containerOptions.map(container => {
            const linked =
              linkedTraditionIds(profile).has(container.tradition?.id) ||
              (container.scales || []).some(scale =>
                linkedScaleIds(profile).has(scale.scale_id)
              );

            const prefix = linked
              ? ""
              : state.labMode
                ? "[laboratorio] "
                : "";

            return option(
              container.container_id,
              `${prefix}${container.tradition?.label || container.container_id} · ${container.period?.id || ""}`,
              container.container_id === node.containerId
            );
          }).join("")}
        </select>
      </div>

      <div class="field">
        <label>5. Scala o modo</label>
        <select
          data-node-id="${node.id}"
          data-field="scaleId"
          ${node.containerId ? "" : "disabled"}
        >
          <option value="">Seleziona scala</option>
          ${scaleOptions.map(scale =>
            option(
              scale.scale_id,
              scale.name,
              scale.scale_id === node.scaleId
            )
          ).join("")}
        </select>
      </div>

      ${renderNodeDetails(node)}
    </article>
  `;
}


const reliabilityLevels = {
  "alta": 3,
  "alta-media": 2.5,
  "media-alta": 2.5,
  "media": 2,
  "bassa-media": 1.5,
  "media-bassa": 1.5,
  "bassa": 1,
  "molto-bassa": 0.5,
  "non-determinata": 0.5,
  "non-documentata": 0.5
};

function normalizedReliabilityKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-")
    .replace(/\s+/g, "-");
}

function reliabilityScore(value, fallback = 1.5) {
  const key = normalizedReliabilityKey(value);

  return Object.prototype.hasOwnProperty.call(
    reliabilityLevels,
    key
  )
    ? reliabilityLevels[key]
    : fallback;
}

function reliabilityLabel(score) {
  if (score >= 2.75) {
    return "alta";
  }

  if (score >= 2.25) {
    return "media-alta";
  }

  if (score >= 1.75) {
    return "media";
  }

  if (score >= 1.25) {
    return "bassa-media";
  }

  return "bassa";
}

function reliabilityClass(value) {
  return normalizedReliabilityKey(value) || "non-determinata";
}

function containsAny(text, terms) {
  const normalized = String(text || "").toLowerCase();

  return terms.some(term => normalized.includes(term));
}

function scaleEvidenceBasis(scale) {
  const measuredSequence = asArray(
    scale?.historical_tuning?.measured_natural_sequence
  );
  const measuredIntervals = asArray(
    scale?.historical_tuning?.measured_intervals_cents
  );

  if (measuredSequence.length || measuredIntervals.length) {
    return {
      key: "measured",
      label: "misure acustiche pubblicate",
      structureScore: 3,
      pitchScore: 3
    };
  }

  if (
    scale?.historical_tuning?.tuning_name ||
    scale?.historical_tuning?.mode_name ||
    scale?.historical_tuning?.genus ||
    scale?.historical_context?.work
  ) {
    return {
      key: "theoretical",
      label: "struttura teorica o notazionale documentata",
      structureScore: 2.5,
      pitchScore: 1
    };
  }

  return {
    key: "documented",
    label: "profilo documentato",
    structureScore: 2,
    pitchScore: 1.5
  };
}

function approximationProfile(scale) {
  const status = normalizedReliabilityKey(
    scale?.approximation?.status
  );
  const warning = String(scale?.approximation?.warning || "");
  const alternative =
    scale?.approximation?.alternative_upper_rounding;

  let score = 2;
  let label = "approssimazione operativa";

  if (
    status.includes("misur") ||
    status.includes("da-misure")
  ) {
    score = 2.5;
    label = "approssimazione derivata da misure";
  } else if (
    status.includes("ambig") ||
    alternative
  ) {
    score = 1;
    label = "mappatura 12-TET ambigua";
  } else if (
    status.includes("sintesi") ||
    containsAny(warning, [
      "convenzionale",
      "non costituisce",
      "non attribuisce",
      "non documentata"
    ])
  ) {
    score = 1.5;
    label = "mappatura 12-TET convenzionale";
  }

  return {
    score,
    label,
    status: status || "non-specificato",
    hasAlternative: Boolean(
      alternative &&
      asArray(alternative.pitch_classes).length
    )
  };
}

function centerReliabilityProfile(scale) {
  const centerText = [
    scale?.center?.type,
    scale?.center?.historical_reference,
    scale?.historical_tuning?.absolute_pitch,
    scale?.historical_tuning?.tonal_center
  ].filter(Boolean).join(" ");

  if (
    containsAny(centerText, [
      "convenzionale",
      "non documentat",
      "non determin",
      "riferimento computazionale"
    ])
  ) {
    return {
      score: 1,
      label: "centro convenzionale o non determinato"
    };
  }

  if (
    scale?.historical_tuning?.keynote ||
    containsAny(centerText, [
      "misurat",
      "reperto"
    ])
  ) {
    return {
      score: 3,
      label: "centro sostenuto da misure"
    };
  }

  return {
    score: 1.5,
    label: "centro relativo"
  };
}

function declaredScaleReliability(scale) {
  const declared = scale?.transition_reliability || {};
  const values = Object.entries(declared)
    .filter(([key, value]) =>
      key !== "reason" &&
      typeof value === "string"
    );

  const byKey = new Map(
    values.map(([key, value]) => [
      normalizedReliabilityKey(key),
      value
    ])
  );

  const historicalPitch =
    byKey.get("historical-pitch-comparison") ||
    byKey.get("historical-pitch") ||
    null;

  const twelveTet =
    byKey.get("twelve-tet-transition") ||
    byKey.get("12-tet-transition") ||
    null;

  const structure =
    byKey.get("interval-structure-comparison") ||
    byKey.get("structural-scale-comparison") ||
    byKey.get("modal-structure-comparison") ||
    byKey.get("structure-comparison") ||
    null;

  return {
    historicalPitch,
    twelveTet,
    structure,
    reason: declared.reason || ""
  };
}

function scaleReliabilityProfile(scale) {
  const basis = scaleEvidenceBasis(scale);
  const approximation = approximationProfile(scale);
  const center = centerReliabilityProfile(scale);
  const declared = declaredScaleReliability(scale);

  const structureScore = declared.structure
    ? reliabilityScore(
        declared.structure,
        basis.structureScore
      )
    : basis.structureScore;

  const pitchScore = declared.historicalPitch
    ? reliabilityScore(
        declared.historicalPitch,
        basis.pitchScore
      )
    : basis.pitchScore;

  const mappingScore = declared.twelveTet
    ? reliabilityScore(
        declared.twelveTet,
        approximation.score
      )
    : approximation.score;

  return {
    basis,
    approximation,
    center,
    declared,
    structureScore,
    pitchScore,
    mappingScore,
    structureLabel: reliabilityLabel(structureScore),
    pitchLabel: reliabilityLabel(pitchScore),
    mappingLabel: reliabilityLabel(mappingScore)
  };
}

function pitchClassVariants(scale) {
  const variants = [];
  const primary = asArray(scale?.pitch_classes_12tet)
    .map(Number)
    .filter(Number.isFinite);

  if (primary.length) {
    variants.push({
      key: "primary",
      label: "mappatura principale",
      pitchClasses: primary
    });
  }

  const alternative =
    scale?.approximation?.alternative_upper_rounding;
  const alternativePcs = asArray(
    alternative?.pitch_classes
  )
    .map(Number)
    .filter(Number.isFinite);

  if (alternativePcs.length) {
    variants.push({
      key: "alternative-upper",
      label: "arrotondamento alternativo superiore",
      pitchClasses: alternativePcs
    });
  }

  return variants;
}

function comparePitchClassArrays(
  sourcePitchClasses,
  targetPitchClasses,
  centerDistance
) {
  const sourceSet = new Set(sourcePitchClasses);
  const targetSet = new Set(targetPitchClasses);
  const common = [...sourceSet]
    .filter(value => targetSet.has(value))
    .sort((a, b) => a - b);
  const removed = sortedDifference(sourceSet, targetSet);
  const added = sortedDifference(targetSet, sourceSet);
  const cost =
    ((removed.length + added.length) * 2) +
    centerDistance;

  return {
    common,
    removed,
    added,
    cost
  };
}

function variantSensitivity(
  sourceScale,
  targetScale,
  centerDistance
) {
  const sourceVariants = pitchClassVariants(sourceScale);
  const targetVariants = pitchClassVariants(targetScale);
  const combinations = [];

  sourceVariants.forEach(sourceVariant => {
    targetVariants.forEach(targetVariant => {
      const comparison = comparePitchClassArrays(
        sourceVariant.pitchClasses,
        targetVariant.pitchClasses,
        centerDistance
      );

      combinations.push({
        sourceVariant,
        targetVariant,
        ...comparison
      });
    });
  });

  if (!combinations.length) {
    return {
      combinations: [],
      commonMin: 0,
      commonMax: 0,
      costMin: 0,
      costMax: 0,
      sensitive: false
    };
  }

  const commonValues = combinations.map(
    item => item.common.length
  );
  const costValues = combinations.map(item => item.cost);

  return {
    combinations,
    commonMin: Math.min(...commonValues),
    commonMax: Math.max(...commonValues),
    costMin: Math.min(...costValues),
    costMax: Math.max(...costValues),
    sensitive:
      new Set(commonValues).size > 1 ||
      new Set(costValues).size > 1 ||
      sourceVariants.length > 1 ||
      targetVariants.length > 1
  };
}

function transitionReliability(
  sourceScale,
  targetScale,
  variantAnalysis
) {
  const source = scaleReliabilityProfile(sourceScale);
  const target = scaleReliabilityProfile(targetScale);

  const structureScore = Math.min(
    source.structureScore,
    target.structureScore
  );
  const pitchScore = Math.min(
    source.pitchScore,
    target.pitchScore
  );
  const mappingScore = Math.min(
    source.mappingScore,
    target.mappingScore
  );
  const centerScore = Math.min(
    source.center.score,
    target.center.score
  );

  let documentaryPenalty =
    Math.round((3 - mappingScore) * 3) +
    Math.round((3 - centerScore) * 2);

  if (variantAnalysis.sensitive) {
    documentaryPenalty += 2;
  }

  const warnings = [];

  if (mappingScore < 2.25) {
    warnings.push(
      "Le note comuni dipendono da una mappatura 12-TET convenzionale."
    );
  }

  if (centerScore < 2) {
    warnings.push(
      "La distanza dei centri usa almeno un centro non documentato come altezza assoluta."
    );
  }

  if (variantAnalysis.sensitive) {
    warnings.push(
      "Il risultato cambia usando una mappatura alternativa conservata nei dati."
    );
  }

  warnings.push(
    "Gli accordi pivot sono costruzioni armoniche moderne, non collegamenti storici."
  );

  return {
    source,
    target,
    structureScore,
    pitchScore,
    mappingScore,
    centerScore,
    structureLabel: reliabilityLabel(structureScore),
    pitchLabel: reliabilityLabel(pitchScore),
    mappingLabel: reliabilityLabel(mappingScore),
    centerLabel: reliabilityLabel(centerScore),
    documentaryPenalty,
    warnings
  };
}

function renderReliabilityBadge(label, prefix = "") {
  return `
    <span class="transition-reliability-badge reliability-${reliabilityClass(label)}">
      ${escapeHtml(prefix)}${escapeHtml(label)}
    </span>
  `;
}

function renderScaleReliabilitySummary(profile, scale) {
  return `
    <div class="scale-reliability-summary">
      <div>
        <strong>${escapeHtml(profile.basis.label)}</strong>
        <span class="small">
          Affidabilità strutturale:
          ${renderReliabilityBadge(profile.structureLabel)}
        </span>
      </div>

      <div>
        <strong>${escapeHtml(profile.approximation.label)}</strong>
        <span class="small">
          Affidabilità della mappatura:
          ${renderReliabilityBadge(profile.mappingLabel)}
        </span>
      </div>

      <div>
        <strong>${escapeHtml(profile.center.label)}</strong>
        <span class="small">
          Affidabilità del centro:
          ${renderReliabilityBadge(
            reliabilityLabel(profile.center.score)
          )}
        </span>
      </div>

      ${
        profile.declared.reason
          ? `
            <p class="small transition-reliability-reason">
              ${escapeHtml(profile.declared.reason)}
            </p>
          `
          : ""
      }
    </div>
  `;
}

function pitchClassSet(scale) {
  return new Set(
    (scale?.pitch_classes_12tet || []).map(Number)
  );
}

function sortedDifference(left, right) {
  return [...left]
    .filter(value => !right.has(value))
    .sort((a, b) => a - b);
}

function minimalCenterDistance(sourceCenter, targetCenter) {
  const raw = Math.abs(Number(sourceCenter) - Number(targetCenter)) % 12;
  return Math.min(raw, 12 - raw);
}

function pivotChords(sourceScale, targetScale) {
  const sourceHarmony = harmonizeScale(sourceScale);
  const targetHarmony = harmonizeScale(targetScale);
  const targetByKey = new Map(
    targetHarmony.map(chord => [chord.key, chord])
  );

  return sourceHarmony
    .filter(chord => targetByKey.has(chord.key))
    .map(chord => ({
      source: chord,
      target: targetByKey.get(chord.key)
    }));
}

function compareNodes(sourceNode, targetNode) {
  const sourceScale = scaleForNode(sourceNode);
  const targetScale = scaleForNode(targetNode);

  if (!sourceScale || !targetScale) {
    return null;
  }

  const sourceSet = pitchClassSet(sourceScale);
  const targetSet = pitchClassSet(targetScale);
  const common = [...sourceSet]
    .filter(value => targetSet.has(value))
    .sort((a, b) => a - b);
  const removed = sortedDifference(sourceSet, targetSet);
  const added = sortedDifference(targetSet, sourceSet);
  const sameSet =
    removed.length === 0 &&
    added.length === 0;
  const centerDistance = minimalCenterDistance(
    sourceScale.center?.pitch_class ?? 0,
    targetScale.center?.pitch_class ?? 0
  );

  let technique = "Transizione contrastante";

  if (sameSet) {
    technique = "Ricentratura modale o tonale";
  } else if (common.length >= 6) {
    technique = "Mutazione di una nota";
  } else if (common.length >= 5) {
    technique = "Passaggio per note comuni";
  } else if (common.length >= 3) {
    technique = "Ponte parziale";
  }

  const pivots = pivotChords(sourceScale, targetScale);
  const cost =
    ((removed.length + added.length) * 2) +
    centerDistance;
  const variantAnalysis = variantSensitivity(
    sourceScale,
    targetScale,
    centerDistance
  );
  const reliability = transitionReliability(
    sourceScale,
    targetScale,
    variantAnalysis
  );
  const documentaryCost =
    cost +
    reliability.documentaryPenalty;

  return {
    sourceScale,
    targetScale,
    common,
    removed,
    added,
    centerDistance,
    sameSet,
    technique,
    pivots,
    cost,
    documentaryCost,
    variantAnalysis,
    reliability
  };
}

function renderEdge(sourceNode, targetNode) {
  const comparison = compareNodes(sourceNode, targetNode);

  if (!comparison) {
    return `
      <div class="edge-column">
        <div class="edge-line"></div>
        <div class="edge-badge missing">
          Completa entrambe le tappe
        </div>
      </div>
    `;
  }

  return `
    <div class="edge-column">
      <div class="edge-line"></div>
      <div class="edge-badge reliability-edge">
        <strong>${escapeHtml(comparison.technique)}</strong>
        <span class="small">
          ${comparison.common.length} note comuni
          · costo tecnico ${comparison.cost}
        </span>
        <span class="small">
          Costo documentale ${comparison.documentaryCost}
          · 12-TET ${escapeHtml(comparison.reliability.mappingLabel)}
        </span>
        ${renderReliabilityBadge(
          comparison.reliability.structureLabel,
          "struttura "
        )}
      </div>
    </div>
  `;
}

function renderCanvas() {
  if (!state.labMode && areas().length === 0) {
    ui.canvas.innerHTML = `
      <div class="verified-selection-empty">
        <h3>Nessuna opzione documentata disponibile</h3>
        <p>
          Il filtro principale mostra soltanto centri con una tradizione
          documentata e almeno una scala documentata realmente presente
          nel catalogo.
        </p>
        <p class="small">
          Compila <code>tradition_links</code> e <code>scale_links</code>
          con <code>relation_status: "documentato"</code>, oppure apri
          la modalità laboratorio per usare i dati dimostrativi.
        </p>
        <a class="button-link" href="VIAGGIO_CENTRI.html?mode=laboratory">
          Apri modalità laboratorio
        </a>
      </div>
    `;
    return;
  }

  const pieces = [];

  state.nodes.forEach((node, index) => {
    pieces.push(renderNode(node, index));

    if (index < state.nodes.length - 1) {
      pieces.push(renderEdge(node, state.nodes[index + 1]));
    }
  });

  ui.canvas.innerHTML = pieces.join("");

  ui.canvas.querySelectorAll("select[data-field]").forEach(select => {
    select.addEventListener("change", event => {
      setNodeField(
        Number(event.currentTarget.dataset.nodeId),
        event.currentTarget.dataset.field,
        event.currentTarget.value
      );
    });
  });

  ui.canvas.querySelectorAll(".remove-node").forEach(button => {
    button.addEventListener("click", event => {
      const nodeId = Number(event.currentTarget.dataset.nodeId);

      state.nodes = state.nodes.filter(node => node.id !== nodeId);
      render();
    });
  });
}

function formatPcs(values) {
  if (!values.length) {
    return "nessuna";
  }

  return values.map(value =>
    pitchClassNames[Number(value)] || String(value)
  ).join(", ");
}

function renderResults() {
  const resultCards = [];

  for (let index = 0; index < state.nodes.length - 1; index += 1) {
    const sourceNode = state.nodes[index];
    const targetNode = state.nodes[index + 1];
    const comparison = compareNodes(sourceNode, targetNode);

    if (!comparison) {
      continue;
    }

    const sourceProfile = profileById(sourceNode.profileId);
    const targetProfile = profileById(targetNode.profileId);
    const sourceRelation = relationForNode(sourceNode);
    const targetRelation = relationForNode(targetNode);
    const sensitivity = comparison.variantAnalysis;

    resultCards.push(`
      <article class="result-card reliability-result-card">
        <h3>
          ${escapeHtml(labelForNode(index))}
          →
          ${escapeHtml(labelForNode(index + 1))}
          ·
          ${escapeHtml(sourceProfile?.center_label || "")}
          →
          ${escapeHtml(targetProfile?.center_label || "")}
        </h3>

        <div class="transition-documentary-summary">
          <div>
            <strong>Affidabilità della struttura</strong>
            ${renderReliabilityBadge(
              comparison.reliability.structureLabel
            )}
          </div>

          <div>
            <strong>Affidabilità delle altezze storiche</strong>
            ${renderReliabilityBadge(
              comparison.reliability.pitchLabel
            )}
          </div>

          <div>
            <strong>Affidabilità della mappatura 12-TET</strong>
            ${renderReliabilityBadge(
              comparison.reliability.mappingLabel
            )}
          </div>

          <div>
            <strong>Affidabilità del centro</strong>
            ${renderReliabilityBadge(
              comparison.reliability.centerLabel
            )}
          </div>
        </div>

        <div class="result-meta">
          <div class="meta-box">
            <strong>Scale</strong><br>
            ${escapeHtml(comparison.sourceScale.name)}
            →
            ${escapeHtml(comparison.targetScale.name)}
          </div>

          <div class="meta-box">
            <strong>Tecnica principale</strong><br>
            ${escapeHtml(comparison.technique)}
          </div>

          <div class="meta-box">
            <strong>Note comuni</strong><br>
            ${comparison.common.length}
          </div>

          <div class="meta-box">
            <strong>Distanza dei centri</strong><br>
            ${comparison.centerDistance} semitoni
          </div>

          <div class="meta-box">
            <strong>Costo tecnico</strong><br>
            ${comparison.cost}
          </div>

          <div class="meta-box documentary-cost-box">
            <strong>Costo corretto documentalmente</strong><br>
            ${comparison.documentaryCost}
            <span class="small">
              penalità +${comparison.reliability.documentaryPenalty}
            </span>
          </div>
        </div>

        <details class="transition-reliability-details" open>
          <summary>Basi documentali delle due tappe</summary>

          <div class="transition-reliability-columns">
            <section>
              <h4>
                ${escapeHtml(
                  sourceProfile?.center_label ||
                  comparison.sourceScale.name
                )}
              </h4>
              ${renderScaleReliabilitySummary(
                comparison.reliability.source,
                comparison.sourceScale
              )}
            </section>

            <section>
              <h4>
                ${escapeHtml(
                  targetProfile?.center_label ||
                  comparison.targetScale.name
                )}
              </h4>
              ${renderScaleReliabilitySummary(
                comparison.reliability.target,
                comparison.targetScale
              )}
            </section>
          </div>
        </details>

        <div class="transition-details">
          <p>
            <strong>Note comuni nella mappatura principale:</strong>
            ${escapeHtml(formatPcs(comparison.common))}
          </p>
          <p>
            <strong>Da rimuovere:</strong>
            ${escapeHtml(formatPcs(comparison.removed))}
          </p>
          <p>
            <strong>Da aggiungere:</strong>
            ${escapeHtml(formatPcs(comparison.added))}
          </p>
        </div>

        ${
          sensitivity.sensitive
            ? `
              <div class="transition-sensitivity">
                <strong>Sensibilità alle mappature alternative</strong>
                <p>
                  Note comuni:
                  ${sensitivity.commonMin}
                  –
                  ${sensitivity.commonMax}
                  · costo tecnico:
                  ${sensitivity.costMin}
                  –
                  ${sensitivity.costMax}
                </p>

                <details>
                  <summary>Mostra le combinazioni considerate</summary>
                  <div class="variant-combination-list">
                    ${sensitivity.combinations.map(item => `
                      <div>
                        <strong>
                          ${escapeHtml(item.sourceVariant.label)}
                          →
                          ${escapeHtml(item.targetVariant.label)}
                        </strong>
                        <span>
                          ${item.common.length} note comuni
                          · costo ${item.cost}
                        </span>
                      </div>
                    `).join("")}
                  </div>
                </details>
              </div>
            `
            : ""
        }

        <div class="solution-list">
          <div class="solution">
            <strong>Soluzione tecnica · ${escapeHtml(comparison.technique)}</strong><br>
            Conservare le note comuni e introdurre progressivamente
            ${comparison.added.length || "nessuna nuova nota"}.
          </div>

          ${
            comparison.pivots.length
              ? `
                <div class="solution modern-pivot-solution">
                  <strong>
                    Accordi pivot proposti — costruzione moderna
                  </strong><br>
                  ${comparison.pivots.slice(0, 5).map(pivot =>
                    `${escapeHtml(pivot.source.name)} / ${escapeHtml(pivot.target.name)} (${escapeHtml(pivot.source.notes.join(" – "))})`
                  ).join("<br>")}
                </div>
              `
              : `
                <div class="solution modern-pivot-solution">
                  <strong>
                    Accordi pivot proposti — costruzione moderna
                  </strong><br>
                  Nessuna triade identica trovata nelle due
                  armonizzazioni 12-TET.
                </div>
              `
          }
        </div>

        <div class="transition-documentary-warnings">
          <strong>Avvertenze documentali</strong>
          <ul>
            ${comparison.reliability.warnings.map(warning => `
              <li>${escapeHtml(warning)}</li>
            `).join("")}
            <li>
              La somiglianza calcolata non dimostra contatto storico,
              discendenza o reciproca intelligibilità musicale.
            </li>
          </ul>
        </div>

        ${
          sourceRelation?.kind === "laboratory" ||
          targetRelation?.kind === "laboratory"
            ? `
              <div class="note transition-lab-note">
                Almeno una delle due associazioni centro-scala è
                dimostrativa e non rappresenta un’attribuzione storica.
              </div>
            `
            : ""
        }
      </article>
    `);
  }

  ui.results.innerHTML = resultCards.length
    ? resultCards.join("")
    : `
      <div class="empty">
        Completa almeno due tappe con una scala per calcolare il viaggio.
      </div>
    `;
}

function completedNodes() {
  return state.nodes.filter(node =>
    Boolean(
      node.areaId &&
      node.periodId &&
      node.profileId &&
      node.containerId &&
      node.scaleId
    )
  );
}

function updateModeInterface() {
  if (ui.modeBanner) {
    ui.modeBanner.className = state.labMode
      ? "note selection-mode-banner laboratory-selection-banner"
      : "note selection-mode-banner verified-selection-banner";

    ui.modeBanner.innerHTML = state.labMode
      ? `
        <strong>Modalità laboratorio</strong><br>
        Sono visibili anche associazioni dimostrative non documentate.
        Nessuna associazione viene salvata nei profili dei centri.
      `
      : `
        <strong>Filtro documentale attivo</strong><br>
        Sono selezionabili soltanto catene complete con
        <code>tradition_links</code> e <code>scale_links</code>
        nello stato <code>documentato</code>.
      `;
  }

  if (ui.loadExample) {
    ui.loadExample.hidden = !state.labMode;
  }

  if (ui.verifiedModeLink) {
    ui.verifiedModeLink.hidden = !state.labMode;
  }

  if (ui.laboratoryModeLink) {
    ui.laboratoryModeLink.hidden = state.labMode;
  }
}

function updateStatus() {
  const completed = completedNodes().length;
  const eligibleProfiles = centerIndex.profiles.filter(
    profileHasDocumentedChain
  ).length;

  ui.status.textContent = state.labMode
    ? (
      `${state.nodes.length} tappe presenti; ${completed} complete. ` +
      `Modalità laboratorio attiva; ` +
      `${centerIndex.stats?.profiles ?? centerIndex.profiles.length} profili totali.`
    )
    : (
      `${state.nodes.length} tappe presenti; ${completed} complete. ` +
      `${eligibleProfiles} centri con catena documentata e risolta.`
    );
}

function render() {
  updateModeInterface();

  try {
    renderCanvas();
    renderResults();
    updateStatus();
  } catch (error) {
    console.error("Errore durante il rendering del viaggio:", error);

    if (ui.canvas) {
      ui.canvas.innerHTML = `
        <div class="verified-selection-empty">
          <h3>Errore nella lettura dei dati musicali</h3>
          <p>
            Uno dei cataloghi non rispetta ancora la struttura prevista.
            Esegui il comando <strong>Valida musica documentata</strong>
            e consulta il rapporto generato.
          </p>
          <p class="small">
            Dettaglio tecnico:
            <code>${escapeHtml(error?.message || String(error))}</code>
          </p>
        </div>
      `;
    }

    if (ui.status) {
      ui.status.textContent =
        "Rendering interrotto: controllare il rapporto di validazione.";
    }
  }

  ui.addNode.disabled = state.nodes.length >= state.maxNodes;
}

function addNode() {
  if (state.nodes.length >= state.maxNodes) {
    return;
  }

  state.nodes.push(createEmptyNode());
  render();
}

function resetJourney() {
  state.nodes = [
    createEmptyNode(),
    createEmptyNode(),
    createEmptyNode(),
    createEmptyNode()
  ];

  render();
}

function firstProfile(areaId, preferredCenter = "") {
  const matches = (state.labMode
    ? centerIndex.profiles
    : selectableProfiles())
    .filter(profile => profile.area?.id === areaId)
    .sort((a, b) =>
      String(a.center_label).localeCompare(String(b.center_label), "it")
    );

  return (
    matches.find(profile =>
      String(profile.center_label)
        .toLocaleLowerCase("it")
        .includes(preferredCenter.toLocaleLowerCase("it"))
    ) ||
    matches[0] ||
    null
  );
}

function secondProfile(areaId, excludedProfileId) {
  return (state.labMode
    ? centerIndex.profiles
    : selectableProfiles())
    .filter(profile =>
      profile.area?.id === areaId &&
      profile.profile_id !== excludedProfileId
    )
    .sort((a, b) =>
      String(a.center_label).localeCompare(String(b.center_label), "it")
    )[0] || null;
}

function firstContainer(areaId, preferredTradition = "") {
  const matches = catalog.containers
    .filter(container => container.area?.id === areaId);

  return (
    matches.find(container =>
      String(container.tradition?.label || "")
        .toLocaleLowerCase("it")
        .includes(preferredTradition.toLocaleLowerCase("it"))
    ) ||
    matches[0] ||
    null
  );
}

function applyExampleNode(
  node,
  profile,
  container,
  preferredScaleId = ""
) {
  if (!profile || !container) {
    return;
  }

  const scale =
    (container.scales || []).find(
      item => item.scale_id === preferredScaleId
    ) ||
    container.scales?.[0] ||
    null;

  node.areaId = profile.area?.id || "";
  node.periodId = profile.period?.id || "";
  node.profileId = profile.profile_id;
  node.containerId = container.container_id;
  node.scaleId = scale?.scale_id || "";
}

function loadExample() {
  if (!state.labMode) {
    window.location.href =
      "VIAGGIO_CENTRI.html?mode=laboratory";
    return;
  }

  const gerico = firstProfile("ASW", "Gerico");
  const europe = firstProfile("EUR_MED");
  const southAsia = firstProfile("SA");
  const secondAsw = secondProfile("ASW", gerico?.profile_id);

  const maqam = firstContainer("ASW", "Maq");
  const western = firstContainer("EUR_MED", "tonale");
  const hindustani = firstContainer("SA", "hindustani");

  state.nodes = [
    createEmptyNode(),
    createEmptyNode(),
    createEmptyNode(),
    createEmptyNode()
  ];

  applyExampleNode(
    state.nodes[0],
    gerico,
    maqam,
    "HIJAZ_D_DEMO"
  );

  applyExampleNode(
    state.nodes[1],
    europe,
    western,
    "G_HARMONIC_MINOR_DEMO"
  );

  applyExampleNode(
    state.nodes[2],
    southAsia,
    hindustani,
    "BHAIRAV_D_DEMO"
  );

  applyExampleNode(
    state.nodes[3],
    secondAsw || gerico,
    maqam,
    "KURD_D_DEMO"
  );

  render();
}

function calculateJourney() {
  renderResults();

  ui.results.scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
}

function exportJourney() {
  const payload = {
    schema_version: 1,
    exported_at: new Date().toISOString(),
    laboratory_mode: state.labMode,
    selection_mode: state.labMode ? "laboratory" : "verified",
    verified_relation_statuses:
      [...verifiedStatuses],
    warning: state.labMode
      ? "Le associazioni di laboratorio non costituiscono attribuzioni storiche."
      : "Il viaggio contiene soltanto collegamenti documentati secondo la politica di selezione.",
    nodes: state.nodes.map((node, index) => {
      const profile = profileById(node.profileId);
      const container = containerById(node.containerId);
      const scale = scaleForNode(node);
      const relation = relationForNode(node);

      return {
        label: labelForNode(index),
        area: profile?.area || null,
        period: profile?.period || null,
        center: profile
          ? {
              profile_id: profile.profile_id,
              center_id: profile.center_id,
              center_label: profile.center_label,
              record_status: profile.record_status
            }
          : null,
        tradition: container?.tradition || null,
        scale: scale
          ? {
              scale_id: scale.scale_id,
              name: scale.name,
              center: scale.center,
              notes_12tet: scale.notes_12tet,
              pitch_classes_12tet: scale.pitch_classes_12tet
            }
          : null,
        relation
      };
    }),
    transitions: state.nodes
      .slice(0, -1)
      .map((node, index) => {
        const comparison = compareNodes(
          node,
          state.nodes[index + 1]
        );

        return comparison
          ? {
              from: labelForNode(index),
              to: labelForNode(index + 1),
              technique: comparison.technique,
              common_pitch_classes: comparison.common,
              removed_pitch_classes: comparison.removed,
              added_pitch_classes: comparison.added,
              center_distance: comparison.centerDistance,
              technical_cost: comparison.cost,
              documentary_cost: comparison.documentaryCost,
              documentary_penalty:
                comparison.reliability.documentaryPenalty,
              reliability: {
                structure:
                  comparison.reliability.structureLabel,
                historical_pitch:
                  comparison.reliability.pitchLabel,
                twelve_tet_mapping:
                  comparison.reliability.mappingLabel,
                center:
                  comparison.reliability.centerLabel
              },
              variant_sensitivity: {
                sensitive:
                  comparison.variantAnalysis.sensitive,
                common_min:
                  comparison.variantAnalysis.commonMin,
                common_max:
                  comparison.variantAnalysis.commonMax,
                cost_min:
                  comparison.variantAnalysis.costMin,
                cost_max:
                  comparison.variantAnalysis.costMax
              },
              warnings:
                comparison.reliability.warnings
            }
          : null;
      })
      .filter(Boolean)
  };

  const blob = new Blob(
    [JSON.stringify(payload, null, 2)],
    { type: "application/json" }
  );
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = "viaggio-musicale-centri.json";
  anchor.click();

  URL.revokeObjectURL(url);
}

ui.addNode.addEventListener("click", addNode);

if (ui.loadExample) {
  ui.loadExample.addEventListener("click", loadExample);
}
ui.resetJourney.addEventListener("click", resetJourney);
ui.calculateJourney.addEventListener("click", calculateJourney);
ui.exportJourney.addEventListener("click", exportJourney);

resetJourney();
