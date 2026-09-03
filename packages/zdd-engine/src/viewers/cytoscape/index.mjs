// `cytoscape` viewer — the reference human index: lanes / columns / explorer /
// force views over the graph, a detail panel per node, and the glossary + ADR
// corpus as read-only slide-outs. viz.html / viz.css / viz.js derive from an
// Apache-2.0 proof-of-concept (LICENSE-NOTICE.md in this folder); the engine
// outside this folder is MIT and never imports from it — the registry loads
// it by name and hands it the graph (src/viewers/index.mjs).
//
// The embedded `window.BUNDLE` is this viewer's private data shape (node
// data carries colour + size, bodies keyed by id, the embedded docs). It is
// rebuilt here from the neutral graph artifact so the artifact stays
// viewer-free, and so the output stays byte-identical to the pre-registry
// engine for the same inputs (test/golden/human-index-bundle-*.json).

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

// Palette keys are display-type names on purpose (legends and the dark-mode
// fold in viz.js key on them). Module / Database Function / Storage Bucket
// have their own entries so they stay distinguishable across views.
const TYPE_PALETTE = {
  "API Endpoint": "#2a78d6",
  "Table": "#008300",
  "UI Surface": "#e87ba4",
  "Feature": "#4a3aa7",
  "External Service": "#eda100",
  "Database Function": "#0d9488",
  "Storage Bucket": "#b45309",
  "Module": "#64748b",
};
const DEFAULT_NODE_COLOR = "#94a3b8";

const embed = (value) => JSON.stringify(value).replace(/</g, "\\u003c");
const escapeHtml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function toBundle(graph, docs, changed, options, repoBase) {
  const nodes = graph.nodes.map((n) => ({
    data: {
      id: n.id,
      label: n.title,
      type: n.type,
      description: n.description,
      resource: n.resource,
      tags: n.tags,
      ...(n.auth ? { auth: n.auth } : {}),
      color: TYPE_PALETTE[n.type] ?? DEFAULT_NODE_COLOR,
      size: 30 + Math.min(60, Math.floor(n.body.length / 200)),
    },
  }));
  const edges = graph.edges.map((e) => ({ data: { id: `${e.source}__${e.target}`, source: e.source, target: e.target } }));
  const bodies = Object.fromEntries(graph.nodes.map((n) => [n.id, n.body]));
  const types = [...new Set(graph.nodes.map((n) => n.type))].sort();
  return {
    nodes,
    edges,
    bodies,
    types,
    palette: TYPE_PALETTE,
    repoBase,
    viewer: options,
    // Glossary + ADR corpus embedded whole: the hosted wiki's audience has no
    // checkout, so the stores ride along as read-only projections.
    docs: { glossary: docs.glossary, adrs: docs.adrs, changed },
  };
}

export function render({ graph, docs, changed, options, bundleName, repoBase }) {
  const bundle = toBundle(graph, docs, changed, options, repoBase);
  const read = (...p) => readFileSync(join(HERE, ...p), "utf8");
  return read("viz.html")
    .replace("/*__CYTOSCAPE_JS__*/", () => read("vendor", "cytoscape.min.js"))
    .replace("/*__MARKED_JS__*/", () => read("vendor", "marked.min.js"))
    .replace("/*__SAFE_MARKED_JS__*/", () => read("safe-marked.js"))
    .replace("/*__VIZ_CSS__*/", () => read("viz.css"))
    .replace("/*__VIZ_JS__*/", () => read("viz.js"))
    .replace("__BUNDLE_TITLE__", () => escapeHtml(`${bundleName} Wiki`))
    .replace("__BUNDLE_NAME__", () => embed(bundleName))
    .replace("__BUNDLE_DATA__", () => embed(bundle));
}
