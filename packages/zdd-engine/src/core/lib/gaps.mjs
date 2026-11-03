// The map's gaps (decision 0049): records that should link and do not. An
// adapter's `unread` list says what it saw and could not read; this is the
// second net, for what no adapter looks at — a route that reaches nothing
// because its data-access library has no reader, a table nothing reaches.
//
// What counts, by record kind and never by stack: by default a route, a
// surface (a screen) or a background task that links to nothing, and a
// table nothing links to. An adapter may name further kinds of its own
// records as an optional contract step:
//
//   export const GAPS = { reachNothing: ["<kind>"], reachedByNothing: ["<kind>"] };
//
// The whole repo, every run, never a diff: lint computes the list from the
// records derive wrote, and `derive --check` keeps those true. A gap is
// answered once, with the same one-time marks as unread items, in
// zdd/config.json:
//
//   "gaps": { "strict": true, "fine": [{ id, what, why }], "known": [{ id, what, why }] }
//
// `fine`: nothing to map (a health check touches no table). `known`: it
// cannot be mapped (table names built at runtime) — it stays in the human
// index and the agent index as a part of the map not to trust. Fixed is no
// mark: an adapter now reads it, and the gap is gone.
//
// An id is the direction and the record's id, hashed, so a mark lapses when
// the record is renamed and survives everything else about it. Stack-free
// like everything under core/.

import { createHash } from "node:crypto";
import { marksConfig, oneLine, cut } from "./unread.mjs";

export const GAP_KIND = "gap";
export const DEFAULT_GAP_KINDS = Object.freeze({ reachNothing: ["background-task", "route", "surface"], reachedByNothing: ["table"] });
export const DIRECTIONS = Object.freeze({ reachNothing: "reaches nothing", reachedByNothing: "nothing reaches it" });
export const GAP_ID = /^gap:[a-z][a-z0-9_-]*\/[0-9a-f]{16}$/;
export const GAP_ANSWERS = ["fine", "known"];
// Kinds one adapter may name per direction: a short list, never a stack's catalogue.
export const MAX_GAP_KINDS = 50;
// Gaps in all (CR-360): no more than the answer lists can hold, so every gap
// can be answered. Past it the kinds or the readers are wrong, and the list
// stops before it is sorted or printed.
export const MAX_GAPS = 10_000;
// A kind as a record carries it (derive's KIND_RE); `unread` is the core's.
const KIND_RE = /^[a-z][a-z0-9_-]*$/;

// The records each record links to, by refs and typed edges, that exist
// and are not itself: the one rule the coverage report and the gaps share.
export function outLinks(records) {
  const ids = new Set(records.map((r) => r.id));
  const outs = new Map();
  for (const r of records) {
    const to = new Set(Array.isArray(r.refs) ? r.refs : []);
    const edges = r.facts?.edges;
    if (edges && typeof edges === "object") for (const list of Object.values(edges)) if (Array.isArray(list)) for (const id of list) to.add(id);
    outs.set(r.id, [...to].filter((id) => typeof id === "string" && ids.has(id) && id !== r.id));
  }
  return outs;
}

// An adapter's GAPS export, checked: { reachNothing, reachedByNothing } or
// { error }. Absent is nothing added.
export function checkGaps(name, value) {
  if (value === undefined) return { reachNothing: [], reachedByNothing: [] };
  const fail = (msg) => ({ error: `adapter '${name}': GAPS ${msg} (decision 0049)` });
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail("must be an object { reachNothing: [kinds], reachedByNothing: [kinds] }");
  const extra = Object.keys(value).find((k) => !Object.hasOwn(DIRECTIONS, k));
  if (extra !== undefined) return fail(`has an unknown key ${JSON.stringify(cut(oneLine(extra), 40))} (known: ${Object.keys(DIRECTIONS).join(", ")})`);
  const out = {};
  for (const dir of Object.keys(DIRECTIONS)) {
    const list = value[dir] ?? [];
    if (!Array.isArray(list) || list.length > MAX_GAP_KINDS) return fail(`.${dir} must be an array of at most ${MAX_GAP_KINDS} record kinds`);
    const bad = list.find((k) => typeof k !== "string" || !KIND_RE.test(k) || k === "unread");
    if (bad !== undefined) return fail(`.${dir} names ${JSON.stringify(cut(oneLine(String(bad)), 40))}, which is not a record kind`);
    out[dir] = [...new Set(list)];
  }
  return out;
}

// The kinds that count: the core's defaults, plus every kind the repo's
// adapters name. `adapters` is [{ name, mod }]. Returns the lists, sorted,
// or { error } naming the first adapter whose GAPS is malformed.
export function gapKinds(adapters) {
  const out = { reachNothing: new Set(DEFAULT_GAP_KINDS.reachNothing), reachedByNothing: new Set(DEFAULT_GAP_KINDS.reachedByNothing) };
  for (const { name, mod } of adapters) {
    const g = checkGaps(name, mod?.GAPS);
    if (g.error) return { error: g.error };
    for (const dir of Object.keys(DIRECTIONS)) for (const k of g[dir]) out[dir].add(k);
  }
  return { reachNothing: [...out.reachNothing].sort(), reachedByNothing: [...out.reachedByNothing].sort() };
}

const gapId = (kind, dir, recordId) => `${GAP_KIND}:${kind}/${createHash("sha256").update(`${dir}\0${recordId}`).digest("hex").slice(0, 16)}`;

// The gaps in a set of records, sorted by kind, then title, then id: each
// { id, record, kind, title, file, direction, what }. Every field is one
// plain line, since the records may have been edited by hand.
export function gapsOf(records, kinds = DEFAULT_GAP_KINDS) {
  const list = records.filter((r) => r && typeof r.id === "string" && typeof r.kind === "string" && r.kind !== "unread");
  const outs = outLinks(list);
  const reached = new Set();
  for (const to of outs.values()) for (const id of to) reached.add(id);
  const items = [];
  const add = (r, dir) => {
    if (items.length >= MAX_GAPS) throw new Error(`the map has more than ${MAX_GAPS} gaps — more than can be answered; an adapter's GAPS names a kind that should not link, or a reader is missing for most of the repo (decision 0049)`);
    const title = cut(oneLine(String(r.title || r.id)), 200);
    const file = Array.isArray(r.resource) && typeof r.resource[0] === "string" ? oneLine(r.resource[0]) : "";
    items.push({ id: gapId(r.kind, dir, r.id), record: oneLine(r.id), kind: r.kind, title, file, direction: dir, what: `${r.kind} ${title}: ${DIRECTIONS[dir]}` });
  };
  for (const r of list) {
    if (kinds.reachNothing.includes(r.kind) && !outs.get(r.id).length) add(r, "reachNothing");
    if (kinds.reachedByNothing.includes(r.kind) && !reached.has(r.id)) add(r, "reachedByNothing");
  }
  return items.sort((a, b) => (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : a.title < b.title ? -1 : a.title > b.title ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// The `gaps` block of the config: { strict, fine, known } (each a Map) or { error }.
export function gapsConfig(config) {
  return marksConfig(config, "gaps", {
    lists: GAP_ANSWERS,
    idRe: GAP_ID,
    idShape: `${GAP_KIND}:<kind>/<hash>`,
    itemName: "a gap",
    reason: (answer) => (answer === "known" ? "a known gap says why it cannot be mapped" : "a mark says why there is nothing to map"),
  });
}

// Gaps against marks: `open` has no answer yet; `fine` and `known` carry
// each mark's reason; `stale` is a mark no gap answers any more (the record
// now links, or it is gone). A stale mark excuses nothing, so it warns and
// never fails: fixing an adapter must not turn CI red.
export function gapReport(items, cfg) {
  const ids = new Set(items.map((i) => i.id));
  const answered = (answer) => items.filter((i) => cfg[answer].has(i.id)).map((i) => ({ ...i, why: oneLine(cfg[answer].get(i.id).why) }));
  return {
    strict: cfg.strict,
    open: items.filter((i) => !GAP_ANSWERS.some((a) => cfg[a].has(i.id))),
    fine: answered("fine"),
    known: answered("known"),
    stale: GAP_ANSWERS.flatMap((a) => [...cfg[a].keys()]).filter((id) => !ids.has(id)).sort(),
  };
}

// How a person answers, said wherever an open gap is named.
export const GAP_ROUTE = 'fix the adapter that should read it (the extractor skill), or answer it once: the plugin\'s `bootstrap.mjs gaps --fine=<id> --why="…"` (nothing to map) or `--known=<id> --why="…"` (cannot be mapped; it stays visible in both indexes), kept in zdd/config.json\'s gaps';
