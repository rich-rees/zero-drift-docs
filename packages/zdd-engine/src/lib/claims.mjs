// Which metadata records a Feature claims. A feature slice (a `type: Feature`
// concept in the semantic map) claims a record by LINKING it — the same link
// render turns into an edge and the freshness nudge watches. A route, table,
// function or surface that no feature links is UNCLAIMED: inventoried by the
// extractors, placed in no feature. Shared by `lint` (the unclaimed-records
// warning, CAS-63, decision 0009) so the rule is written once; the viewers
// compute the same count from the graph's Feature→metadata edges, and a
// test pins the two to the same number.
//
// Kinds that count: the ones a feature slice is expected to place. Modules
// and buckets are plumbing a feature reaches through its routes and tables,
// and listing them would bury the checklist in noise.
//
// Both stores are read the hardened way (review CR-002/CR-003): symlinks are
// skipped, never followed (lstat), walks are depth- and entry-bounded, and
// every file is read through `readBounded` — a record or a concept over the
// cap is skipped here (the blessing lint already reports the oversized
// concept; `derive --check` owns malformed metadata).

import { readdirSync, lstatSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { parseFrontmatter } from "./frontmatter.mjs";
import { extractLinks } from "./map-links.mjs";
import { walkMarkdown, readBounded, MAX_STORE_FILE_BYTES } from "./walk-markdown.mjs";

export const CLAIMABLE_KINDS = ["route", "table", "function", "surface"];
const MAX_DEPTH = 4; // metadataDir/<kind>/<file>.json — anything deeper is not derive's
const MAX_ENTRIES = 20_000;

const posixify = (p) => p.split(/[\\/]/).join("/");

// Regular .json files under `dir`, sorted, links skipped, bounded. What it
// does not see goes to `state.skipped` when the caller passes one (CAS-65
// CR-029): a link, an unreadable entry, a depth or entry cut-off.
function walkJson(dir, out = [], state = { depth: 0, entries: 0 }) {
  const skip = (path, reason) => state.skipped?.push({ path, reason });
  if (state.depth > MAX_DEPTH) {
    skip(dir, `deeper than ${MAX_DEPTH} levels — not walked`);
    return out;
  }
  let names;
  try {
    if (!lstatSync(dir).isDirectory()) {
      if (lstatSync(dir).isSymbolicLink()) skip(dir, "a symlink — not followed");
      return out; // a symlinked or non-dir root is not a store
    }
    names = readdirSync(dir).sort();
  } catch {
    return out;
  }
  for (const name of names) {
    if (++state.entries > MAX_ENTRIES) {
      skip(dir, `the walk passed ${MAX_ENTRIES} entries — the rest not read`);
      return out;
    }
    const p = join(dir, name);
    let st;
    try {
      st = lstatSync(p);
    } catch {
      skip(p, "unreadable");
      continue;
    }
    if (st.isSymbolicLink()) {
      skip(p, "a symlink — not followed");
      continue;
    }
    // One counter for the whole walk: a copied `entries` let every subtree
    // start its budget afresh (CAS-63 review CR-026).
    if (st.isDirectory()) {
      const child = { depth: state.depth + 1, entries: state.entries, skipped: state.skipped };
      walkJson(p, out, child);
      state.entries = child.entries;
    }
    else if (st.isFile() && name.endsWith(".json")) out.push(p);
  }
  return out;
}

// The claimable records under metadataDir, each with the node id a map link
// resolves to (bundle-relative path minus extension), sorted by id.
export function claimableRecords(metadataDir, bundleDir, skipped) {
  const out = [];
  const why = (p) => {
    try {
      const st = lstatSync(p);
      return st.size > MAX_STORE_FILE_BYTES ? `over ${MAX_STORE_FILE_BYTES} bytes` : "unreadable";
    } catch {
      return "unreadable";
    }
  };
  for (const p of walkJson(metadataDir, [], { depth: 0, entries: 0, skipped })) {
    const text = readBounded(p);
    if (text === null) {
      skipped?.push({ path: p, reason: why(p) });
      continue;
    }
    let record;
    try {
      record = JSON.parse(text);
    } catch {
      skipped?.push({ path: p, reason: "not JSON" });
      continue;
    }
    if (!record || typeof record !== "object" || !CLAIMABLE_KINDS.includes(record.kind)) continue;
    const nodeId = posixify(relative(bundleDir, p)).replace(/\.json$/, "");
    out.push({ kind: record.kind, id: String(record.id ?? nodeId), title: String(record.title ?? record.id ?? nodeId), nodeId, file: posixify(relative(dirname(bundleDir), p)) });
  }
  return out.sort((a, b) => (a.nodeId < b.nodeId ? -1 : 1));
}

// Every node id a Feature concept links to, with the feature files linking
// it (repo-relative, sorted) — two or more is a DOUBLE claim (CAS-65).
// Claimants are collected in sets and sorted once at the end — linear in
// the links, where re-sorting per link was quadratic (CAS-65 CR-030).
export function featureClaims(mapDir, bundleDir, skipped) {
  const sets = new Map();
  for (const path of walkMarkdown(mapDir, [], { depth: 0, entries: 0, skipped })) {
    const text = readBounded(path);
    if (text === null) {
      let reason = "unreadable";
      try {
        if (lstatSync(path).size > MAX_STORE_FILE_BYTES) reason = `over ${MAX_STORE_FILE_BYTES} bytes`;
      } catch {
        /* unreadable */
      }
      skipped?.push({ path, reason });
      continue;
    }
    const parsed = parseFrontmatter(text);
    if (!parsed || String(parsed.frontmatter.type) !== "Feature") continue;
    const file = posixify(relative(dirname(bundleDir), path));
    for (const id of extractLinks(parsed.body, dirname(path), bundleDir)) {
      if (!sets.has(id)) sets.set(id, new Set());
      sets.get(id).add(file);
    }
  }
  const claimed = new Map();
  for (const [id, files] of sets) claimed.set(id, [...files].sort());
  return claimed;
}

// The claim picture lint reports: every claimable record, the unclaimed ones,
// and the ones two or more features claim (each with its claiming files).
// `skipped` lists every map or metadata file the pass could not read, as
// { file, reason, record } — the claim picture is incomplete by exactly
// those (CAS-65 CR-029; strict lint fails on them).
export function unclaimedRecords({ metadataDir, mapDir, bundleDir }) {
  const raw = [];
  const claimed = featureClaims(mapDir, bundleDir, raw);
  const records = claimableRecords(metadataDir, bundleDir, raw);
  const skipped = raw
    .map((s) => {
      const inMetadata = !relative(metadataDir, s.path).startsWith("..");
      return { file: posixify(relative(dirname(bundleDir), s.path)), reason: s.reason, record: inMetadata };
    })
    .sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  return {
    skipped,
    total: records.length,
    records,
    unclaimed: records.filter((r) => !claimed.has(r.nodeId)),
    doubleClaimed: records.filter((r) => (claimed.get(r.nodeId)?.length ?? 0) > 1).map((r) => ({ ...r, features: claimed.get(r.nodeId) })),
  };
}

// The same count from a graph artifact (schema zdd-graph/1): metadata nodes
// of a claimable display type with no inbound edge from a Feature node.
// Viewers may copy this rule rather than import it — the viewer contract
// keeps them off engine internals; it is four lines. `layer` matters: a map
// concept may carry any `type`, including one that looks like a record's.
export const CLAIMABLE_TYPES = ["API Endpoint", "Table", "Database Function", "UI Surface"];
export function unclaimedInGraph(graph) {
  const features = new Set(graph.nodes.filter((n) => n.type === "Feature").map((n) => n.id));
  const claimed = new Set(graph.edges.filter((e) => features.has(e.source)).map((e) => e.target));
  const claimable = graph.nodes.filter((n) => n.layer === "metadata" && CLAIMABLE_TYPES.includes(n.type));
  return { total: claimable.length, unclaimed: claimable.filter((n) => !claimed.has(n.id)).length };
}
