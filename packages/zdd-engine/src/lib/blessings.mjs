// The blessing store (ZDD-1, decision 0031): one Markdown file per blessing
// in paths.blessingsDir, a small header and the blessing's text. Shared by
// render (the blessing index), lint (the blessing lints) and tally (the
// never-named list), so there is one reader of the store.
//
//   ---
//   where: apps/api/app/fixed_routes/decisions.py (RouteRefusal)
//   kind: copy
//   applies-to: apps/web
//   first-built-in: features/fixed-routes
//   adr: ADR-0047
//   ---
//
//   A refusal that has to name things? Copy RouteRefusal … — never …
//
// `where` and `kind` are required (lint fails without them); `applies-to`
// and `first-built-in` name semantic-map pages by their path under the map
// folder, without `.md`; `adr` is optional, a reason beside any ADR the text
// cites. The file name (without `.md`) is the blessing's stable id.

import { relative } from "node:path";
import { parseFrontmatter } from "./frontmatter.mjs";
import { blessingShape } from "./map-links.mjs";
import { walkMarkdown, readBounded, MAX_STORE_FILE_BYTES } from "./walk-markdown.mjs";

export const BLESSING_KINDS = ["copy", "extend"];
export const HEADER_KEYS = ["where", "kind", "applies-to", "first-built-in", "adr"];
const CITATION_RE = /\bADR[-\s]?(\d{4})\b/g;

// `path` or `path (Symbol)` -> { path, symbol } with a posix path, or null
// for an empty value. The path is not checked here: lint judges it against
// the repo.
export function parseWhere(value) {
  const v = String(value ?? "").trim();
  if (!v) return null;
  const m = /^(.*?)\s*\(([^()]+)\)$/.exec(v);
  const path = (m ? m[1] : v).trim().replace(/^`|`$/g, "").split("\\").join("/").replace(/^\.\//, "");
  const symbol = m ? m[2].trim().replace(/^`|`$/g, "") : null;
  return path ? { path, symbol: symbol || null } : null;
}

// One blessing file's text -> its parts. `id` is the file name without
// `.md`. A file with no header still parses (header {}), so lint can say
// what is missing rather than skip it.
export function readBlessing(text, id) {
  const parsed = parseFrontmatter(text);
  const header = parsed ? parsed.frontmatter : {};
  const body = (parsed ? parsed.body : text.replace(/\r\n/g, "\n")).trim();
  const blessingText = body.replace(/\s+/g, " ").trim();
  const adrs = [];
  for (const source of [String(header.adr ?? ""), blessingText]) {
    for (const m of source.matchAll(CITATION_RE)) if (!adrs.includes(m[1])) adrs.push(m[1]);
  }
  return {
    id,
    hasHeader: Boolean(parsed),
    header,
    where: parseWhere(header.where),
    kind: header.kind === undefined ? null : String(header.kind).trim(),
    appliesTo: header["applies-to"] ? String(header["applies-to"]).trim().replace(/\.md$/, "") : null,
    firstBuiltIn: header["first-built-in"] ? String(header["first-built-in"]).trim().replace(/\.md$/, "") : null,
    text: blessingText,
    adrs,
    shape: blessingShape(blessingText),
    unknownKeys: Object.keys(header).filter((k) => !HEADER_KEYS.includes(k)).sort(),
  };
}

// Every blessing in the store, sorted by id, read the hardened way (symlinks
// skipped, reads bounded). `unreadable` lists the files over the cap or
// unreadable; `skipped` what the walk did not enter.
export function loadBlessings(dir, repoRoot) {
  const state = { depth: 0, entries: 0, skipped: [] };
  const blessings = [];
  const unreadable = [];
  for (const path of walkMarkdown(dir, [], state)) {
    const rel = relative(repoRoot, path).split(/[\\/]/).join("/");
    const text = readBounded(path, MAX_STORE_FILE_BYTES);
    if (text === null) {
      unreadable.push(rel);
      continue;
    }
    const id = relative(dir, path).split(/[\\/]/).join("/").replace(/\.md$/, "");
    blessings.push({ ...readBlessing(text, id), file: rel });
  }
  blessings.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { blessings, unreadable, skipped: state.skipped };
}

// The users of an `extend` blessing's exemplar, from the metadata (decision
// 0031 point 5). `records`: every derived record ({ id, title, resource,
// refs, facts }). The exemplar's records are those whose `resource` names
// the `where` path; a symbol narrows them to the records it names, when any
// does. A user is a record that references one of them, or one they say is
// using them (`facts.edges.usedBy`) — every inbound reference counts, the
// side decision 0011 errs on. Returns null when no record has the file:
// "unknown to ZDD", never zero.
export function usersOf(where, records) {
  if (!where) return null;
  const has = (r) => (Array.isArray(r.resource) ? r.resource : [r.resource]).some((p) => typeof p === "string" && p.split("\\").join("/").replace(/^\.\//, "") === where.path);
  let own = records.filter(has);
  if (!own.length) return null;
  if (where.symbol) {
    const names = (r) => [r.title, r.facts?.name, r.facts?.export, ...(Array.isArray(r.facts?.handlers) ? r.facts.handlers : [])].filter((x) => typeof x === "string").map((x) => x.replace(/\(\)$/, ""));
    const named = own.filter((r) => names(r).includes(where.symbol));
    if (named.length) own = named;
  }
  const ownIds = new Set(own.map((r) => r.id));
  const users = new Map();
  for (const r of records) {
    if (ownIds.has(r.id)) continue;
    // A `usedBy` id sits in `refs` too (decision 0016), and points the other
    // way: the referrer is the one used, never a user.
    const usedBy = new Set(r.facts?.edges?.usedBy ?? []);
    if ((r.refs ?? []).some((ref) => ownIds.has(ref) && !usedBy.has(ref))) users.set(r.id, r);
  }
  const byId = new Map(records.map((r) => [r.id, r]));
  for (const r of own) {
    for (const id of r.facts?.edges?.usedBy ?? []) if (!ownIds.has(id) && byId.has(id)) users.set(id, byId.get(id));
  }
  return [...users.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
