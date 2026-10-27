// supabase-js adapter — data access through the Supabase JavaScript client
// (decision 0037). One convention: `.from('x')` / `.from(CONST)` (a table,
// else a bucket), `.rpc('x')` (a database function), and Realtime
// subscriptions — the client's own `.on("postgres_changes", { table })` and
// any helper named in `subscribeCalls` — in JS and TS source. One
// `data-access` record per code unit that makes such a call (adapters/js:
// a top-level declaration by its local name, the module's own top-level
// code as `<module>`), keyed by file + unit, so a route or screen adapter's
// `?code:<file>#<name>` names the same text. A unit's calls are its own and
// those of every same-file declaration it mentions, as far as they go (the
// rule decision 0037 sets for both sides). The calls are UNRESOLVED refs
// (`?from:x`, `?function:x`; a subscription is `?table:x` and a `subscribes`
// edge), resolved after the merge against the schema adapter's records; a
// referrer reached through `?code:` takes them as its own, and the core
// absorbs the record when every referrer holds its file.
// Options (extractorOptions["supabase-js"]):
//   roots            repo-relative files or directories to scan (default ["."])
//   extensions       default .ts .tsx .js .jsx .mjs .cjs
//   excludeDirs      directory names skipped (default node_modules, .git,
//                    .next, dist, build, coverage)
//   excludeSuffixes  file endings skipped (default test, spec and .d.ts files)
//   subscribeCalls   call names whose first string argument is a table the
//                    code subscribes to over Realtime (`live.onInsert`) —
//                    read by react-router and nextjs before 0.9 (2.1.0, item 5)
// A missing root is "nothing to inventory" with a diagnostic, never an error.
// Call sites are found on the lexical mask, so a call spelled in a comment
// or a string is not one. Every file is read through `io` (decision 0010).
// Deterministic: same bytes in, same records out.

import { repoRelative } from "../../core/lib/paths.mjs";
import { closeOver, dataAccessRecord } from "../../core/lib/data-access.mjs";
import { codeUnits, jsFiles, matchBracket, model, stringAt, topLevel, DEFAULT_EXCLUDE_DIRS, DEFAULT_EXCLUDE_SUFFIXES, DEFAULT_EXTENSIONS } from "../js/source.mjs";

export const FACTS_KEY_ORDER = {
  "data-access": ["function", "edges"],
};

// Data calls in one file: `.from('x')` / `.from(CONST)` (a table or bucket)
// and `.rpc('x')` (a database function). Call sites are found on the mask —
// a call spelled inside a string or a comment is not one (1.3.0 CR-020) —
// and literals read from the text. `consts` resolves `.from(NAME)` against
// the module's own `const NAME = '…'` bindings; a name it cannot resolve is
// in `unresolved` (a class's static `Array.from(xs)` is not a client call).
export function scanDataCalls(text, consts = moduleConsts(text)) {
  const m = model(text);
  const from = new Set();
  const rpc = new Set();
  const unresolved = new Set();
  for (const hit of m.mask.matchAll(/\.(from|rpc)\(\s*(?:(['"])|([A-Za-z_$][\w$]*)\s*\))/g)) {
    if (hit[2]) {
      const raw = stringAt(m, hit.index + hit[0].length - 1);
      if (raw === null) continue;
      if (hit[1] === "from" && /^[\w-]+$/.test(raw)) from.add(raw);
      if (hit[1] === "rpc" && /^\w+$/.test(raw)) rpc.add(raw);
    } else if (hit[1] === "from" && consts.has(hit[3])) from.add(consts.get(hit[3]));
    else if (hit[1] === "from" && !/(?:^|[^\w$.])[A-Z][\w$]*\s*$/.test(m.mask.slice(Math.max(0, hit.index - 64), hit.index))) unresolved.add(hit[3]);
  }
  return { from, rpc, unresolved };
}
// Realtime subscriptions (2.1.0, item 5): a surface that reads a table over
// Supabase Realtime bypasses the API, so the dependency is a `subscribes`
// edge to the table. Two shapes, both on the mask: the client's own
// `.on("postgres_changes", { …, table: "<name>" })` with a literal table,
// and any call the adopter names in `subscribeCalls` (`live.onInsert`)
// whose FIRST argument is the table name as a string literal. A table that
// is a variable is not seen — the same honesty as the call scanners. A name
// may carry its schema (`public.audit_events`); the resolver matches it
// either way (2.1.1).
const TABLE_NAME = /^(?:[\w-]+\.)?[\w-]+$/;
export function scanSubscriptions(text, helpers = []) {
  const m = model(text);
  const out = new Set();
  for (const hit of m.mask.matchAll(/\.on\(\s*(['"])/g)) {
    const q = hit.index + hit[0].length - 1;
    if (stringAt(m, q) !== "postgres_changes") continue;
    const open = m.mask.indexOf("(", hit.index);
    const close = matchBracket(m.mask, open);
    if (close === -1) continue;
    const args = m.mask.slice(open, close);
    const t = /\btable\s*:\s*(['"])/.exec(args);
    if (!t) continue;
    const raw = stringAt(m, open + t.index + t[0].length - 1);
    if (raw !== null && TABLE_NAME.test(raw)) out.add(raw);
  }
  for (const helper of helpers) {
    if (typeof helper !== "string" || !/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(helper)) continue;
    const re = new RegExp(`(?<![\\w$.])${helper.replace(/[.$]/g, "\\$&")}\\s*\\(\\s*(['"])`, "g");
    for (const hit of m.mask.matchAll(re)) {
      const raw = stringAt(m, hit.index + hit[0].length - 1);
      if (raw !== null && TABLE_NAME.test(raw)) out.add(raw);
    }
  }
  return out;
}

// A module's `const NAME = 'literal'` bindings, found on the mask.
export function moduleConsts(text) {
  const m = model(text);
  const out = new Map();
  for (const hit of m.mask.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*(['"])/g)) {
    const raw = stringAt(m, hit.index + hit[0].length - 1);
    if (raw !== null && /^[\w-]+$/.test(raw)) out.set(hit[1], raw);
  }
  return out;
}


const stringList = (v, key) => {
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) throw new Error(`supabase-js: '${key}' must be an array of strings`);
  return v;
};

export function derive({ options, io }) {
  const diagnostics = [];
  const {
    roots = ["."],
    extensions = DEFAULT_EXTENSIONS,
    excludeDirs = DEFAULT_EXCLUDE_DIRS,
    excludeSuffixes = DEFAULT_EXCLUDE_SUFFIXES,
    subscribeCalls = [],
  } = options;
  for (const [key, v] of Object.entries({ roots, extensions, excludeDirs, excludeSuffixes, subscribeCalls })) stringList(v, key);
  const files = jsFiles(io, roots.map((r) => repoRelative(r, "supabase-js.roots")), { extensions, excludeDirs, excludeSuffixes }, diagnostics);
  const records = [];
  for (const rel of files) {
    const read = io.read(rel);
    if (!read.ok) {
      if (read.code !== "missing" && read.code !== "ignored") diagnostics.push(`${rel}: ${read.reason} — skipped`);
      continue;
    }
    const text = read.text;
    const mod = topLevel(text);
    const unitOf = codeUnits(mod);
    const consts = moduleConsts(text);
    const { commentAbove } = model(text);
    // Each unit's own calls, and the same-file units it mentions.
    const units = new Map(); // name -> { name, refers, from, rpc, subs, start }
    const unit = (name, start) => units.get(name) ?? units.set(name, { name, refers: new Set(), from: new Set(), rpc: new Set(), subs: new Set(), start }).get(name);
    mod.statements.forEach((st, k) => {
      const name = unitOf[k];
      if (name === null) return;
      const u = unit(name, st.start);
      const slice = text.slice(st.start, st.end);
      const data = scanDataCalls(slice, consts);
      for (const n of data.from) u.from.add(n);
      for (const n of data.rpc) u.rpc.add(n);
      for (const ident of data.unresolved) diagnostics.push(`${rel}: .from(${ident}) — identifier not resolvable file-locally`);
      for (const t of scanSubscriptions(slice, subscribeCalls)) u.subs.add(t);
      for (const id of st.mentions) for (const j of mod.decls.get(id) ?? []) if (unitOf[j] !== null) u.refers.add(unitOf[j]);
    });
    const entries = [...units.values()];
    const own = (u) => new Set([...[...u.from].map((n) => `f:${n}`), ...[...u.rpc].map((n) => `r:${n}`), ...[...u.subs].map((n) => `s:${n}`)]);
    const closed = closeOver(entries, own);
    for (const u of entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      const tagged = [...closed.get(u.name)];
      if (!tagged.length) continue;
      const pick = (tag, prefix) => tagged.filter((t) => t.startsWith(tag)).map((t) => `${prefix}${t.slice(2)}`);
      const subscribes = [...new Set(pick("s:", "?table:"))].sort();
      const refs = new Set([...pick("f:", "?from:"), ...pick("r:", "?function:"), ...subscribes]);
      records.push(dataAccessRecord("supabase-js", rel, { name: u.name, docstring: commentAbove(u.start) }, refs, subscribes.length ? { subscribes } : undefined));
    }
  }
  return { records, diagnostics };
}
