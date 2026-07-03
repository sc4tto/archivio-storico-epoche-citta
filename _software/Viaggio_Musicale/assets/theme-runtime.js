"use strict";

(function () {
  const FALLBACK = {
    colors: {
      page: "#f4f0e7",
      page_glow: "rgba(255,255,255,.78)",
      surface: "#fffdf8",
      surface_alt: "#faf8f2",
      surface_subtle: "#f5efe3",
      primary: "#2e493f",
      primary_dark: "#243f36",
      primary_light: "#3f6658",
      primary_contrast: "#ffffff",
      text: "#1f2933",
      muted: "#64707d",
      border: "#d8d1c4",
      border_soft: "#e4ded2",
      accent: "#c8a970",
      control_background: "#f3f0e9",
      control_hover: "#e9e4da",
      control_text: "#48515a",
      danger: "#8a3434",
      danger_background: "#fff8f7",
      edge: "#9ca6a1",
      missing_edge: "#dcbcbc",
      canvas_overlay: "rgba(255,253,248,.87)",
      grid_dot: "#d6cec0"
    },
    typography: {
      font_family: "Georgia, \"Times New Roman\", serif",
      base_size: 16,
      line_height: 1.5,
      heading_weight: 700,
      control_weight: 700,
      label_size: 12,
      label_letter_spacing: 0.045
    },
    spacing: { xs: 4, small: 8, medium: 16, large: 24, xl: 32 },
    layout: {
      content_max_width: 1500,
      page_gutter: 16,
      section_gap: 18,
      mobile_breakpoint: 800
    },
    header: {
      padding_y: 32,
      border_width: 5,
      title_min_size: 28,
      title_max_size: 43
    },
    panels: {
      border_radius: 16,
      padding: 22,
      shadow: "0 12px 30px rgba(45,55,50,.09)"
    },
    controls: {
      padding_y: 10,
      padding_x: 14,
      border_radius: 999,
      select_border_radius: 9,
      font_size: 14,
      compact: false
    },
    nodes: {
      width: 292,
      min_height: 345,
      gap: 36,
      padding: 16,
      border_width: 2,
      border_radius: 15,
      top_bar_height: 8,
      index_size: 32,
      shadow: "0 9px 22px rgba(45,55,50,.11)"
    },
    edges: {
      width: 190,
      line_width: 3,
      arrow_size: 11,
      badge_border_radius: 11,
      badge_shadow: "0 4px 12px rgba(45,55,50,.07)",
      show_cost: true,
      show_common_notes: true
    },
    canvas: {
      minimum_height: 430,
      padding: 32,
      background_grid: true,
      grid_size: 22,
      border_radius: 14
    },
    areas: {}
  };

  function deepMerge(base, override) {
    const output = structuredClone(base);

    for (const [key, value] of Object.entries(override || {})) {
      if (
        value &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        output[key] &&
        typeof output[key] === "object" &&
        !Array.isArray(output[key])
      ) {
        output[key] = deepMerge(output[key], value);
      } else {
        output[key] = value;
      }
    }

    return output;
  }

  function px(value, fallback) {
    const resolved = Number.isFinite(Number(value)) ? Number(value) : fallback;
    return `${resolved}px`;
  }

  function applyTheme(theme) {
    const merged = deepMerge(FALLBACK, theme || {});
    const root = document.documentElement;
    const c = merged.colors;
    const t = merged.typography;
    const s = merged.spacing;
    const l = merged.layout;
    const h = merged.header;
    const p = merged.panels;
    const controls = merged.controls;
    const n = merged.nodes;
    const e = merged.edges;
    const canvas = merged.canvas;

    const vars = {
      "--page": c.page,
      "--page-glow": c.page_glow,
      "--surface": c.surface,
      "--surface-alt": c.surface_alt,
      "--surface-subtle": c.surface_subtle,
      "--primary": c.primary,
      "--primary-dark": c.primary_dark,
      "--primary-light": c.primary_light,
      "--primary-contrast": c.primary_contrast,
      "--text": c.text,
      "--muted": c.muted,
      "--border": c.border,
      "--border-soft": c.border_soft,
      "--accent": c.accent,
      "--control-background": c.control_background,
      "--control-hover": c.control_hover,
      "--control-text": c.control_text,
      "--danger": c.danger,
      "--danger-background": c.danger_background,
      "--edge": c.edge,
      "--missing-edge": c.missing_edge,
      "--canvas-overlay": c.canvas_overlay,
      "--grid-dot": c.grid_dot,

      "--font-family": t.font_family,
      "--base-size": px(t.base_size, 16),
      "--line-height": String(t.line_height ?? 1.5),
      "--heading-weight": String(t.heading_weight ?? 700),
      "--control-weight": String(t.control_weight ?? 700),
      "--label-size": px(t.label_size, 12),
      "--label-letter-spacing": `${Number(t.label_letter_spacing ?? 0.045)}em`,

      "--space-xs": px(s.xs, 4),
      "--space-small": px(s.small, 8),
      "--space-medium": px(s.medium, 16),
      "--space-large": px(s.large, 24),
      "--space-xl": px(s.xl, 32),

      "--content-max-width": px(l.content_max_width, 1500),
      "--page-gutter": px(l.page_gutter, 16),
      "--section-gap": px(l.section_gap, 18),

      "--header-padding-y": px(h.padding_y, 32),
      "--header-border-width": px(h.border_width, 5),
      "--header-title-min": px(h.title_min_size, 28),
      "--header-title-max": px(h.title_max_size, 43),

      "--panel-radius": px(p.border_radius, 16),
      "--panel-padding": px(p.padding, 22),
      "--panel-shadow": p.shadow,

      "--control-padding-y": px(controls.padding_y, 10),
      "--control-padding-x": px(controls.padding_x, 14),
      "--control-radius": px(controls.border_radius, 999),
      "--select-radius": px(controls.select_border_radius, 9),
      "--control-font-size": px(controls.font_size, 14),

      "--node-width": px(n.width, 292),
      "--node-min-height": px(n.min_height, 345),
      "--node-gap": px(n.gap, 36),
      "--node-padding": px(n.padding, 16),
      "--node-border-width": px(n.border_width, 2),
      "--node-radius": px(n.border_radius, 15),
      "--node-top-bar-height": px(n.top_bar_height, 8),
      "--node-index-size": px(n.index_size, 32),
      "--node-shadow": n.shadow,

      "--edge-width": px(e.width, 190),
      "--edge-line-width": px(e.line_width, 3),
      "--edge-arrow-size": px(e.arrow_size, 11),
      "--edge-badge-radius": px(e.badge_border_radius, 11),
      "--edge-badge-shadow": e.badge_shadow,

      "--canvas-min-height": px(canvas.minimum_height, 430),
      "--canvas-padding": px(canvas.padding, 32),
      "--canvas-grid-size": px(canvas.grid_size, 22),
      "--canvas-radius": px(canvas.border_radius, 14)
    };

    for (const [name, value] of Object.entries(vars)) {
      if (value !== undefined && value !== null) {
        root.style.setProperty(name, String(value));
      }
    }

    root.dataset.compactControls = controls.compact ? "true" : "false";
    root.dataset.canvasGrid = canvas.background_grid ? "true" : "false";
    root.dataset.showEdgeCost = e.show_cost ? "true" : "false";
    root.dataset.showCommonNotes = e.show_common_notes ? "true" : "false";

    return merged;
  }

  function areaColor(theme, areaId) {
    return (
      theme?.areas?.[areaId] ||
      theme?.colors?.[areaId] ||
      "#7b8f87"
    );
  }

  window.ThemeSystem = {
    fallback: FALLBACK,
    deepMerge,
    applyTheme,
    areaColor
  };
})();
