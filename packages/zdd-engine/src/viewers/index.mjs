// Viewer registry — the output-end plug-in point, the counterpart of the
// extractor registry in derive.mjs. A viewer turns the graph artifact
// (zdd/graph.json, schema `zdd-graph/1`) plus the read-only store projections
// into ONE self-contained human-index.html. Selected by NAME from config
// (`viewer: "minimal"` or `viewer: { name: "cytoscape", ...options }`); an
// unknown name is refused with the registry listed. There is no local viewer
// directory: a viewer is a contribution to the registry (CONTRIBUTING.md).
//
// Contract — each viewer module exports:
//   render({ graph, docs, changed, options, bundleName, repoBase }) -> string
// where `graph` is exactly what render wrote to graph.json, `docs` is
// { glossary, adrs } (embedded store copies), `changed` is the latest-store-
// change highlight ({ adrs, glossaryTerms }), and `options` is the adopter's
// viewer object minus `name`, plus `nonAreaTags` (the resolved top-level list)
// whenever it is non-empty — a viewer's area model must exclude the same tags
// the graph's inheritance did. Output must be deterministic (byte-identical for
// identical inputs) and safe to host: no network calls, no secrets, and
// source-derived text never reaches innerHTML unsanitised (CR-007).

export const VIEWERS = {
  cytoscape: "./cytoscape/index.mjs",
  minimal: "./minimal/index.mjs",
};
export const DEFAULT_VIEWER = "cytoscape";

export async function loadViewer(name) {
  if (!Object.hasOwn(VIEWERS, name)) {
    // JSON-quoted: the name is config-controlled and goes to a CI log (CR-013).
    throw new Error(`Unknown viewer ${JSON.stringify(name)} (registered: ${Object.keys(VIEWERS).sort().join(", ")})`);
  }
  const mod = await import(VIEWERS[name]);
  if (typeof mod.render !== "function") throw new Error(`Viewer '${name}' exports no render()`);
  return mod;
}
