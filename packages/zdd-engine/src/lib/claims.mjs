// Which metadata records a Feature claims. A feature slice (a `type: Feature`
// concept in the semantic map) claims a record by LINKING it — the same link
// render turns into an edge and the freshness nudge watches. A route, table,
// function or surface that no feature links is UNCLAIMED: inventoried by the
// extractors, placed in no feature. Shared by `lint` (the unclaimed-records
// warning, CAS-63) so the rule is written once; the viewers compute the same
// count from the graph's Feature→metadata edges, and a test pins the two to
// the same number.
//
// Kinds that count: the ones a feature slice is expected to place. Modules
// and buckets are plumbing a feature reaches through its routes and tables,
// and listing them would bury the checklist in noise.

import { readFileSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { parseFrontmatter } from "./frontmatter.mjs";
import { extractLinks } from "./map-links.mjs";
import { walkMarkdown } from "./walk-markdown.mjs";
import { walkDir } from "./walk.mjs";

export const CLAIMABLE_KINDS = ["route", "table", "function", "surface"];

const posixify = (p) => p.split(/[\\/]/).join("/");

// The claimable records under metadataDir, each with the node id a map link
// resolves to (bundle-relative path minus extension), sorted by id.
export function claimableRecords(metadataDir, bundleDir) {
  const out = [];
  walkDir(metadataDir, (p, name) => {
    if (!name.endsWith(".json")) return;
    let record;
    try {
      record = JSON.parse(readFileSync(p, "utf8"));
    } catch {
      return; // derive --check owns malformed metadata; not this lint's job
    }
    if (!CLAIMABLE_KINDS.includes(record.kind)) return;
    const nodeId = posixify(relative(bundleDir, p)).replace(/\.json$/, "");
    out.push({ kind: record.kind, title: String(record.title ?? record.id ?? nodeId), nodeId, file: posixify(relative(dirname(bundleDir), p)) });
  });
  return out.sort((a, b) => (a.nodeId < b.nodeId ? -1 : 1));
}

// Every node id a Feature concept links to.
export function featureClaims(mapDir, bundleDir) {
  const claimed = new Set();
  for (const path of walkMarkdown(mapDir)) {
    const parsed = parseFrontmatter(readFileSync(path, "utf8"));
    if (!parsed || String(parsed.frontmatter.type) !== "Feature") continue;
    for (const id of extractLinks(parsed.body, dirname(path), bundleDir)) claimed.add(id);
  }
  return claimed;
}

export function unclaimedRecords({ metadataDir, mapDir, bundleDir }) {
  const claimed = featureClaims(mapDir, bundleDir);
  const records = claimableRecords(metadataDir, bundleDir);
  return { total: records.length, unclaimed: records.filter((r) => !claimed.has(r.nodeId)) };
}

// The same count from a graph artifact (schema zdd-graph/1): metadata nodes
// of a claimable display type with no inbound edge from a Feature node.
// Viewers may copy this rule rather than import it — the viewer contract
// keeps them off engine internals; it is four lines.
export const CLAIMABLE_TYPES = ["API Endpoint", "Table", "Database Function", "UI Surface"];
export function unclaimedInGraph(graph) {
  const features = new Set(graph.nodes.filter((n) => n.type === "Feature").map((n) => n.id));
  const claimed = new Set(graph.edges.filter((e) => features.has(e.source)).map((e) => e.target));
  const claimable = graph.nodes.filter((n) => n.layer === "metadata" && CLAIMABLE_TYPES.includes(n.type));
  return { total: claimable.length, unclaimed: claimable.filter((n) => !claimed.has(n.id)).length };
}
