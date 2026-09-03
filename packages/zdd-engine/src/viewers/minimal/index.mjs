// `minimal` viewer — the worked example for viewer authors and the proof that
// the viewer seam holds: no libraries, no script, one static page listing the
// graph's nodes (grouped by type) and edges, each node linking to its source.
// Everything a viewer needs is in the `graph` argument; this file never reads
// engine internals. Text is HTML-escaped on the way in — the graph carries
// source-derived strings (comments, docstrings), and the viewer contract says
// they may never reach the page unescaped (CR-007).

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// The renderer refuses a non-http(s) repoBase and a scheme-shaped resource
// before any viewer runs; this is the viewer's own belt (CR-002) — a link is
// only emitted for a bare relative path under an http(s) or empty base.
function href(repoBase, resource) {
  if (!resource) return null;
  if (!/^(https?:\/\/\S*)?$/i.test(repoBase)) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(resource) || resource.startsWith("/")) return null;
  const isFile = /\.[A-Za-z0-9]+$/.test(resource.split("/").pop());
  const path = resource.replace(/\[/g, "%5B").replace(/\]/g, "%5D");
  return (isFile ? repoBase.replace("/tree/", "/blob/") : repoBase) + path;
}

export function render({ graph, bundleName, repoBase }) {
  const byType = new Map();
  for (const n of graph.nodes) {
    if (!byType.has(n.type)) byType.set(n.type, []);
    byType.get(n.type).push(n);
  }
  const titleOf = new Map(graph.nodes.map((n) => [n.id, n.title]));
  const lines = [];
  lines.push("<!DOCTYPE html>", '<html lang="en"><head><meta charset="utf-8">', `<title>${esc(bundleName)} — graph</title>`);
  lines.push("<style>body{font:14px/1.5 system-ui,sans-serif;max-width:60rem;margin:2rem auto;padding:0 1rem}h2{margin-top:2rem}li{margin:.2rem 0}.muted{color:#666}</style>");
  lines.push("</head><body>");
  lines.push(`<h1>${esc(bundleName)}</h1>`);
  lines.push(`<p class="muted">Minimal viewer — ${graph.nodes.length} nodes, ${graph.edges.length} edges. Generated from zdd/graph.json (schema ${esc(graph.schema)}); do not edit.</p>`);
  for (const [type, nodes] of [...byType.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    lines.push(`<h2>${esc(type)} <span class="muted">(${nodes.length})</span></h2>`, "<ul>");
    for (const n of [...nodes].sort((a, b) => (a.title < b.title ? -1 : a.title > b.title ? 1 : 0))) {
      const target = href(repoBase, n.resource);
      const link = n.resource ? (target === null ? ` — ${esc(n.resource)}` : ` — <a href="${esc(target)}">${esc(n.resource)}</a>`) : "";
      const desc = n.description ? ` <span class="muted">${esc(n.description)}</span>` : "";
      lines.push(`<li id="${esc(n.id)}"><b>${esc(n.title)}</b> <code>${esc(n.id)}</code>${link}${desc}</li>`);
    }
    lines.push("</ul>");
  }
  lines.push("<h2>Edges</h2>", "<ul>");
  for (const e of graph.edges) {
    lines.push(`<li><a href="#${esc(e.source)}">${esc(titleOf.get(e.source))}</a> → <a href="#${esc(e.target)}">${esc(titleOf.get(e.target))}</a></li>`);
  }
  lines.push("</ul>", "</body></html>", "");
  return lines.join("\n");
}
