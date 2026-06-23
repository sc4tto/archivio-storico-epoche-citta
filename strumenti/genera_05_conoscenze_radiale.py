#!/usr/bin/env python3
"""Genera soltanto la scheda 05_conoscenze con il layout radiale canonico."""
from __future__ import annotations

from pathlib import Path
import argparse
import html
import json
import math
import os
import sys
from typing import Any

DEFAULT_STATUS = {
    "documentato": {"label": "Documentato nel dossier UNESCO/ICOMOS", "color": "#1f7a5a", "dash": "", "opacity": 1.0},
    "sintesi": {"label": "Riportato in sintesi bibliografiche; verifica primaria richiesta", "color": "#2f6fb0", "dash": "7 4", "opacity": 0.95},
    "inferito": {"label": "Inferenza funzionale o regionale", "color": "#c47a13", "dash": "3 5", "opacity": 0.9},
    "non_documentato": {"label": "Non documentato / domanda aperta", "color": "#8b8f97", "dash": "2 7", "opacity": 0.75},
}

NAV = [
    ("01_alimentazione.html", "Alimentazione"),
    ("02_provenienze.html", "Provenienze"),
    ("03_insediamento.html", "Insediamento"),
    ("04_costruzione.html", "Costruzione"),
    ("05_conoscenze.html", "Conoscenze"),
    ("06_fonti_certezza.html", "Fonti e certezza"),
]


def esc(value: Any) -> str:
    return html.escape(str(value), quote=True)


def rel_url(start: Path, target: Path) -> str:
    return Path(os.path.relpath(target, start)).as_posix()


def load_statuses(center: Path) -> dict[str, dict[str, Any]]:
    master = center / "dati" / "gerico_master.json"
    merged = {key: dict(value) for key, value in DEFAULT_STATUS.items()}
    if master.exists():
        try:
            loaded = json.loads(master.read_text(encoding="utf-8"))
            for key, value in loaded.get("status", {}).items():
                if isinstance(value, dict):
                    merged.setdefault(key, {}).update(value)
        except (OSError, json.JSONDecodeError):
            pass
    return merged


def status_info(statuses: dict[str, dict[str, Any]], key: str) -> dict[str, Any]:
    return statuses.get(key, DEFAULT_STATUS["non_documentato"])


def legend_html(statuses: dict[str, dict[str, Any]]) -> str:
    items = []
    for key in ("documentato", "sintesi", "inferito", "non_documentato"):
        item = status_info(statuses, key)
        dash = "border-top-style:dashed;" if item.get("dash") else ""
        items.append(
            '<div class="legend-item">'
            f'<span class="legend-line" style="border-color:{esc(item["color"])};{dash}"></span>'
            f'{esc(item["label"])}</div>'
        )
    return '<div class="legend">' + "".join(items) + "</div>"


def controls_html() -> str:
    values = [
        ("all", "Tutto"),
        ("documentato", "Documentato"),
        ("sintesi", "Sintesi da verificare"),
        ("inferito", "Inferito"),
        ("non_documentato", "Non documentato"),
    ]
    return '<div class="controls">' + "".join(
        f'<button data-status="{key}" class="{"active" if key == "all" else ""}" '
        f'onclick="setStatus(\'{key}\')">{esc(label)}</button>'
        for key, label in values
    ) + "</div>"


def split_center_label(label: str) -> tuple[str, str]:
    upper = str(label).upper().strip()
    if " DI " in upper:
        first, rest = upper.split(" DI ", 1)
        return first, "DI " + rest
    words = upper.split()
    cut = max(1, len(words) // 2)
    return " ".join(words[:cut]), " ".join(words[cut:])


def category_text(x: float, y: float, label: str) -> str:
    words = str(label).split()
    if len(label) <= 24 or len(words) < 2:
        return (
            f'<text x="{x:.3f}" y="{y:.3f}" text-anchor="middle" '
            f'dominant-baseline="middle" font-size="12" font-weight="700" '
            f'fill="#1f2933">{esc(label)}</text>'
        )
    cut = max(1, len(words) // 2)
    first = " ".join(words[:cut])
    second = " ".join(words[cut:])
    return (
        f'<text text-anchor="middle" dominant-baseline="middle" font-size="12" font-weight="700" fill="#1f2933">'
        f'<tspan x="{x:.3f}" y="{y-8:.3f}">{esc(first)}</tspan>'
        f'<tspan x="{x:.3f}" y="{y+9:.3f}">{esc(second)}</tspan></text>'
    )


def make_svg(tree: dict[str, Any], statuses: dict[str, dict[str, Any]]) -> str:
    width, height = 1500, 1100
    cx, cy = 750.0, 550.0
    inner_radius, outer_radius = 205.0, 405.0
    categories = tree.get("children", [])
    leaves = [(category, leaf) for category in categories for leaf in category.get("children", [])]
    if not categories or not leaves:
        raise ValueError("Gerarchia incompleta nel JSON")

    leaf_angles: dict[str, float] = {}
    for index, (_, leaf) in enumerate(leaves):
        leaf_angles[leaf["id"]] = -math.pi / 2 + index * 2 * math.pi / len(leaves)

    category_angles: dict[str, float] = {}
    for category in categories:
        angles = [leaf_angles[leaf["id"]] for leaf in category.get("children", [])]
        sx = sum(math.cos(angle) for angle in angles)
        sy = sum(math.sin(angle) for angle in angles)
        category_angles[category["id"]] = math.atan2(sy, sx)

    positions: dict[str, tuple[float, float]] = {tree["id"]: (cx, cy)}
    for category in categories:
        angle = category_angles[category["id"]]
        positions[category["id"]] = (cx + inner_radius * math.cos(angle), cy + inner_radius * math.sin(angle))
        for leaf in category.get("children", []):
            angle = leaf_angles[leaf["id"]]
            positions[leaf["id"]] = (cx + outer_radius * math.cos(angle), cy + outer_radius * math.sin(angle))

    parts = [
        f'<svg class="knowledge-radial" viewBox="0 0 {width} {height}" width="{width}" height="{height}" role="img" '
        'style="font-family:Georgia,\'Times New Roman\',serif">',
        '<defs><filter id="shadow"><feDropShadow dx="0" dy="2" stdDeviation="2" flood-opacity=".18"/></filter></defs>',
    ]

    for category in categories:
        sx, sy = positions[tree["id"]]
        tx, ty = positions[category["id"]]
        status = category.get("status", "non_documentato")
        info = status_info(statuses, status)
        dash = f' stroke-dasharray="{esc(info.get("dash", ""))}"' if info.get("dash") else ""
        parts.append(
            f'<path class="edge" data-source="{esc(tree["id"])}" data-target="{esc(category["id"])}" '
            f'data-status="{esc(status)}" d="M {sx:.3f} {sy:.3f} Q {cx:.3f} {cy:.3f} {tx:.3f} {ty:.3f}" '
            f'fill="none" stroke="{esc(info["color"])}" stroke-width="2.2" opacity="{info.get("opacity",1)}"{dash}>'
            f'<title>{esc(tree["label"])} → {esc(category["label"])}</title></path>'
        )
        for leaf in category.get("children", []):
            lx, ly = positions[leaf["id"]]
            leaf_status = leaf.get("status", "non_documentato")
            leaf_info = status_info(statuses, leaf_status)
            leaf_dash = f' stroke-dasharray="{esc(leaf_info.get("dash", ""))}"' if leaf_info.get("dash") else ""
            parts.append(
                f'<path class="edge" data-source="{esc(category["id"])}" data-target="{esc(leaf["id"])}" '
                f'data-status="{esc(leaf_status)}" d="M {tx:.3f} {ty:.3f} Q {cx:.3f} {cy:.3f} {lx:.3f} {ly:.3f}" '
                f'fill="none" stroke="{esc(leaf_info["color"])}" stroke-width="2.2" opacity="{leaf_info.get("opacity",1)}"{leaf_dash}>'
                f'<title>{esc(category["label"])} → {esc(leaf["label"])}</title></path>'
            )

    root_status = tree.get("status", "documentato")
    first_line, second_line = split_center_label(tree.get("label", "Conoscenze"))
    parts.append(
        f'<g class="node" data-id="{esc(tree["id"])}" data-status="{esc(root_status)}">'
        f'<circle cx="{cx}" cy="{cy}" r="82" fill="#2e493f" filter="url(#shadow)"/>'
        f'<text x="{cx}" y="{cy-8}" text-anchor="middle" dominant-baseline="middle" font-size="16" font-weight="700" fill="white">{esc(first_line)}</text>'
        f'<text x="{cx}" y="{cy+16}" text-anchor="middle" dominant-baseline="middle" font-size="16" font-weight="700" fill="white">{esc(second_line)}</text></g>'
    )

    for category in categories:
        x, y = positions[category["id"]]
        status = category.get("status", "non_documentato")
        info = status_info(statuses, status)
        parts.append(
            f'<g class="node" data-id="{esc(category["id"])}" data-status="{esc(status)}"><title>{esc(category["label"])}</title>'
            f'<circle cx="{x:.3f}" cy="{y:.3f}" r="55" fill="#f2eadc" stroke="{esc(info["color"])}" stroke-width="3" filter="url(#shadow)"/>'
            f'{category_text(x, y, category["label"])}</g>'
        )

    for _, leaf in leaves:
        x, y = positions[leaf["id"]]
        status = leaf.get("status", "non_documentato")
        info = status_info(statuses, status)
        anchor = "start" if x >= cx else "end"
        dx = 12 if anchor == "start" else -12
        parts.append(
            f'<g class="node" data-id="{esc(leaf["id"])}" data-status="{esc(status)}"><title>{esc(leaf["label"])}</title>'
            f'<circle cx="{x:.3f}" cy="{y:.3f}" r="9" fill="white" stroke="{esc(info["color"])}" stroke-width="3"/>'
            f'<text x="{x+dx:.3f}" y="{y:.3f}" text-anchor="{anchor}" dominant-baseline="middle" font-size="12" font-weight="600" fill="#1f2933">{esc(leaf["label"])}</text></g>'
        )
    parts.append("</svg>")
    return "".join(parts)


def make_page(tree: dict[str, Any], statuses: dict[str, dict[str, Any]], css_href: str, js_href: str) -> str:
    nav = ['<a href="../index.html">Indice</a>']
    for filename, label in NAV:
        current = ' aria-current="page"' if filename == "05_conoscenze.html" else ""
        nav.append(f'<a href="{filename}"{current}>{esc(label)}</a>')
    body = (
        '<div class="card intro"><div><h2>Perché un albero radiale</h2>'
        '<p>Le conoscenze non formano una sola catena produttiva. Sono competenze organizzate in famiglie, con ramificazioni parallele e collegamenti potenziali fra ambiente, agricoltura, acqua, edilizia e coordinamento sociale.</p>'
        '<div class="note">“Scientifico” è qui inteso come sapere empirico e operativo; il grafico non presume l’esistenza di una scienza formalizzata o scritta.</div></div>'
        '<div><h3>Attendibilità</h3>' + legend_html(statuses) + '</div></div>'
        '<div class="card"><h2>Gerarchia delle competenze</h2>' + controls_html() +
        '<div class="graph-wrap">' + make_svg(tree, statuses) + '</div></div>'
    )
    return f"""<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Gerico — Conoscenze tecnologiche ed empiriche</title>
<link rel="stylesheet" href="{esc(css_href)}">
<script defer src="{esc(js_href)}"></script>
<style>
.knowledge-radial text {{ font-family: Georgia, "Times New Roman", serif; }}
.knowledge-radial .edge {{ fill: none !important; stroke-linecap: round; stroke-linejoin: round; }}
</style>
</head>
<body>
<header><h1>Gerico — Conoscenze tecnologiche ed empiriche</h1><p>Albero radiale delle competenze necessarie o documentate.</p></header>
<nav>{"".join(nav)}</nav>
<main>{body}</main>
</body>
</html>
"""


def generate(root: Path, center: Path) -> Path:
    json_path = center / "dati" / "05_conoscenze.json"
    output = center / "documenti" / "05_conoscenze.html"
    tree = json.loads(json_path.read_text(encoding="utf-8"))
    statuses = load_statuses(center)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(make_page(tree, statuses, rel_url(output.parent, root / "assets" / "style.css"), rel_url(output.parent, root / "assets" / "interactions.js")), encoding="utf-8")
    return output


def verify(root: Path, center: Path) -> list[str]:
    errors: list[str] = []
    json_path = center / "dati" / "05_conoscenze.json"
    html_path = center / "documenti" / "05_conoscenze.html"
    try:
        tree = json.loads(json_path.read_text(encoding="utf-8"))
    except Exception as exc:
        return [f"JSON non valido: {exc}"]
    if not html_path.exists():
        return [f"Pagina non trovata: {html_path}"]
    text = html_path.read_text(encoding="utf-8")
    nodes = 1 + len(tree.get("children", [])) + sum(len(x.get("children", [])) for x in tree.get("children", []))
    edges = nodes - 1
    if text.count('class="node"') != nodes:
        errors.append("Numero di nodi non coerente")
    if text.count('class="edge"') != edges:
        errors.append("Numero di archi non coerente")
    if text.count('fill="none"') < edges:
        errors.append("Archi SVG senza fill=none")
    for token in ('r="82"', 'r="55"', 'r="9"', 'font-size="16"', 'font-size="12"', 'font-weight="700"', 'font-weight="600"', 'font-family: Georgia', 'viewBox="0 0 1500 1100"'):
        if token not in text:
            errors.append(f"Elemento mancante: {token}")
    for asset in (root / "assets" / "style.css", root / "assets" / "interactions.js"):
        if not asset.exists():
            errors.append(f"Asset mancante: {asset}")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description="Genera soltanto la scheda 05_conoscenze radiale")
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--center", type=Path, required=True)
    parser.add_argument("--verify-only", action="store_true")
    args = parser.parse_args()
    root, center = args.root.resolve(), args.center.resolve()
    if not args.verify_only:
        print(f"Pagina generata: {generate(root, center)}")
    errors = verify(root, center)
    if errors:
        print("Verifica NON superata:", file=sys.stderr)
        for error in errors:
            print(" -", error, file=sys.stderr)
        return 1
    print("Verifica superata: gerarchia, archi e tipografia sono coerenti.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
