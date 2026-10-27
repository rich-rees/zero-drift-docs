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
import { MAX_CLOSED, closeOver, dataAccessRecord } from "../../core/lib/data-access.mjs";
import { codeUnits, jsFiles, model, stringAt, topLevel, DEFAULT_EXCLUDE_DIRS, DEFAULT_EXCLUDE_SUFFIXES, DEFAULT_EXTENSIONS } from "../js/source.mjs";

export const FACTS_KEY_ORDER = {
  "data-access": ["function", "edges"],
};

// A table or bucket name as a call or a constant may spell it: a bare name,
// or one schema qualifier (`public.audit_events`); the resolver matches it
// either way (2.1.1, CR-060).
const TABLE_NAME = /^(?:[\w-]+\.)?[\w-]+$/;
// A call on a class's static method (`Array.from(xs)`, `Buffer.from("x")`,
// `Registry.rpc("x")`) is not the client's: the receiver just before the dot
// is a capitalised name with nothing chained before it (CR-052).
const staticReceiver = (mask, dot) => /(?:^|[^\w$.\s])\s*[A-Z][\w$]*\s*$/.test(mask.slice(Math.max(0, dot - 64), dot));

// Data calls in one piece of code: `.from('x')` / `.from(CONST)` (a table or
// bucket) and `.rpc('x')` (a database function). Call sites are found on the
// mask — a call spelled inside a string or a comment is not one (1.3.0
// CR-020) — and literals read from the text. `consts` resolves `.from(NAME)`
// against the `const NAME = '…'` bindings in scope; a name it cannot resolve
// is in `unresolved`.
export function scanDataCalls(text, consts = moduleConsts(text)) {
  const m = model(text);
  const from = new Set();
  const rpc = new Set();
  const unresolved = new Set();
  for (const hit of m.mask.matchAll(/\.(from|rpc)\(\s*(?:(['"])|([A-Za-z_$][\w$]*)\s*\))/g)) {
    if (staticReceiver(m.mask, hit.index)) continue;
    if (hit[2]) {
      const raw = stringAt(m, hit.index + hit[0].length - 1);
      if (raw === null) continue;
      if (hit[1] === "from" && TABLE_NAME.test(raw)) from.add(raw);
      if (hit[1] === "rpc" && /^\w+$/.test(raw)) rpc.add(raw);
    } else if (hit[1] === "from" && consts.has(hit[3])) from.add(consts.get(hit[3]));
    else if (hit[1] === "from") unresolved.add(hit[3]);
  }
  return { from, rpc, unresolved };
}

// Every bracket's partner on the mask, in one pass: open index -> index just
// past its closer, or -1 when it never closes. A scan that matched brackets
// call by call re-read to the end of the file for each malformed call
// (quadratic, CR-051).
function closersOf(mask) {
  const out = new Map();
  const stack = [];
  const pairs = { ")": "(", "]": "[", "}": "{" };
  for (let i = 0; i < mask.length; i++) {
    const ch = mask[i];
    if (ch === "(" || ch === "[" || ch === "{") stack.push(i);
    else if (pairs[ch]) {
      // A closer that does not match the innermost opener leaves the
      // openers unmatched: the source is malformed there.
      if (stack.length && mask[stack[stack.length - 1]] === pairs[ch]) out.set(stack.pop(), i + 1);
    }
  }
  for (const i of stack) out.set(i, -1);
  return out;
}

// Realtime subscriptions (2.1.0, item 5): a surface that reads a table over
// Supabase Realtime bypasses the API, so the dependency is a `subscribes`
// edge to the table. Two shapes, both on the mask: the client's own
// `.on("postgres_changes", { …, table: "<name>" })` — the `table` key of the
// filter object, the call's second argument, never a `table:` inside a
// callback (CR-055) — and any call the adopter names in `subscribeCalls`
// (`live.onInsert`) whose FIRST argument is the table name as a string
// literal. A table that is a variable is not seen — the same honesty as the
// call scanners.
export function scanSubscriptions(text, helpers = []) {
  const m = model(text);
  const out = new Set();
  let closers = null;
  for (const hit of m.mask.matchAll(/\.on\(\s*(['"])/g)) {
    const q = hit.index + hit[0].length - 1;
    if (stringAt(m, q) !== "postgres_changes") continue;
    closers ??= closersOf(m.mask);
    const open = m.mask.indexOf("(", hit.index);
    const close = closers.get(open) ?? -1;
    if (close === -1) continue;
    // The second argument: past the first top-level comma, an object literal.
    let i = q + 1;
    while (i < close && m.mask[i] !== m.mask[q]) i++;
    i++;
    while (i < close && /\s/.test(m.mask[i])) i++;
    if (m.mask[i] !== ",") continue;
    i++;
    while (i < close && /\s/.test(m.mask[i])) i++;
    if (m.mask[i] !== "{") continue;
    const objEnd = closers.get(i) ?? -1;
    if (objEnd === -1) continue;
    // Its own keys only: blank every nested bracket's body first.
    let own = "";
    for (let j = i + 1; j < objEnd - 1; j++) {
      const c = m.mask[j];
      if ((c === "(" || c === "[" || c === "{") && (closers.get(j) ?? -1) !== -1) {
        own += " ".repeat(closers.get(j) - j);
        j = closers.get(j) - 1;
      } else own += c;
    }
    const t = /(?:^|[,{\s])table\s*:\s*(['"])/.exec(own);
    if (!t) continue;
    const raw = stringAt(m, i + 1 + t.index + t[0].length - 1);
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

// The `const NAME = 'literal'` bindings in a piece of code, found on the
// mask; `topOnly` keeps the ones at bracket depth 0 (a module's own, never a
// function's local, CR-053).
export function moduleConsts(text, { topOnly = false } = {}) {
  const m = model(text);
  const out = new Map();
  let depth = 0;
  let at = 0;
  for (const hit of m.mask.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*(['"])/g)) {
    if (topOnly) {
      for (; at < hit.index; at++) {
        const c = m.mask[at];
        if (c === "(" || c === "[" || c === "{") depth++;
        else if (c === ")" || c === "]" || c === "}") depth = Math.max(0, depth - 1);
      }
      if (depth) continue;
    }
    const raw = stringAt(m, hit.index + hit[0].length - 1);
    if (raw !== null && TABLE_NAME.test(raw)) out.set(hit[1], raw);
  }
  return out;
}

// The names a unit binds itself — its parameters and its locals — which
// shadow a top-level declaration of the same name (CR-054): `function
// route(db) { return db(); }` never calls the module's own `db`. Textual: a
// `const` / `let` / `var` / `function` name inside the unit, and the
// identifiers of a parameter list (`function f(a, b)`, `(a, b) =>`, `a =>`),
// a type annotation after `:` excluded. The unit's own declared names are
// never shadows.
const ID_RE = /[A-Za-z_$][\w$]*/g;
function boundInside(mask, own) {
  const out = new Set();
  for (const h of mask.matchAll(/\b(?:const|let|var|function\s*\*?)\s+([A-Za-z_$][\w$]*)/g)) out.add(h[1]);
  // A local destructuring (`const { db } = props`, `let [a, b] = xs`): the
  // pattern's bound names — a key before `:` and a default after `=` bind
  // nothing (verify pass 1 on CR-054).
  for (const h of mask.matchAll(/\b(?:const|let|var)\s*([{[])/g)) {
    const open = h.index + h[0].length - 1;
    // One pass over the pattern's brackets: a computed key — a `[` where an
    // object pattern expects a key, after its `{` or a `,` — is an
    // expression, blanked with everything inside it however deep (CR-075);
    // so is a default, from its `=` to the next comma at that depth. The
    // scan ends at the pattern's own closer, before any type annotation.
    const stack = [];
    let blankTo = -1; // stack depth at which the blanked span ends
    const inDefault = [];
    let prev = "";
    let pattern = "";
    for (let j = open; j < mask.length; j++) {
      const c = mask[j];
      const opener = c === "(" || c === "[" || c === "{";
      const closer = c === ")" || c === "]" || c === "}";
      if (opener) {
        if (blankTo === -1 && c === "[" && stack[stack.length - 1] === "{" && (prev === "{" || prev === ",")) blankTo = stack.length;
        stack.push(c);
        inDefault.push(false);
      } else if (closer) {
        stack.pop();
        inDefault.pop();
        if (!stack.length) break;
        if (blankTo === stack.length) {
          blankTo = -1;
          pattern += " ";
          prev = c;
          continue;
        }
      } else if (blankTo === -1 && c === "=") inDefault[inDefault.length - 1] = true;
      else if (blankTo === -1 && c === ",") inDefault[inDefault.length - 1] = false;
      pattern += j === open || blankTo !== -1 || inDefault.some(Boolean) ? " " : c;
      if (!/\s/.test(c)) prev = c;
    }
    for (const id of pattern.matchAll(ID_RE)) if (!/^\s*:/.test(pattern.slice(id.index + id[0].length))) out.add(id[0]);
  }
  for (const h of mask.matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*)\s*=>/g)) out.add(h[1]);
  const params = (from) => {
    let d = 0;
    let j = from;
    for (; j < mask.length; j++) {
      if (mask[j] === "(") d++;
      else if (mask[j] === ")" && --d === 0) break;
    }
    const list = mask.slice(from + 1, j).replace(/:[^,=)]*/g, " ").replace(/=[^,)]*/g, " ");
    for (const id of list.matchAll(ID_RE)) out.add(id[0]);
    return j;
  };
  for (const h of mask.matchAll(/\bfunction\s*\*?\s*(?:[A-Za-z_$][\w$]*)?\s*(?:<[^>()]*>)?\s*\(/g)) params(h.index + h[0].length - 1);
  for (const h of mask.matchAll(/\(([^()]*)\)\s*(?::[^=;{}]*)?=>/g)) params(h.index);
  for (const n of own) out.delete(n);
  return out;
}

const stringList = (v, key) => {
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) throw new Error(`supabase-js: '${key}' must be an array of strings`);
  return v;
};

export function derive({ options, io }) {
  const diagnostics = [];
  const warnings = [];
  const {
    roots = ["."],
    extensions = DEFAULT_EXTENSIONS,
    excludeDirs = DEFAULT_EXCLUDE_DIRS,
    excludeSuffixes = DEFAULT_EXCLUDE_SUFFIXES,
    subscribeCalls = [],
  } = options;
  for (const [key, v] of Object.entries({ roots, extensions, excludeDirs, excludeSuffixes, subscribeCalls })) stringList(v, key);
  const files = jsFiles(io, roots.map((r) => repoRelative(r, "supabase-js.roots")), { extensions, excludeDirs, excludeSuffixes }, diagnostics, warnings);
  const records = [];
  let overBudget = false;
  for (const rel of files) {
    const read = io.read(rel);
    if (!read.ok) {
      if (read.code === "over-budget") {
        // The total read budget ran out: the rest of the files are unread (CR-057).
        if (!overBudget) warnings.push(`${rel}: the read budget ran out — this file and those after it were not read, so their data access is missing; narrow this adapter's roots`);
        overBudget = true;
        continue;
      }
      if (read.code !== "missing" && read.code !== "ignored") diagnostics.push(`${rel}: ${read.reason} — skipped`);
      continue;
    }
    const text = read.text;
    const mod = topLevel(text);
    const unitOf = codeUnits(mod);
    const topConsts = moduleConsts(text, { topOnly: true });
    const { commentAbove, mask } = model(text);
    // Each unit's own calls, and the same-file units it mentions.
    const units = new Map(); // name -> { name, refers, from, rpc, subs, start }
    const unit = (name, start) => units.get(name) ?? units.set(name, { name, refers: new Set(), from: new Set(), rpc: new Set(), subs: new Set(), start }).get(name);
    mod.statements.forEach((st, k) => {
      const name = unitOf[k];
      if (name === null) return;
      const u = unit(name, st.start);
      const slice = text.slice(st.start, st.end);
      // A unit's own constants shadow the module's (CR-053).
      const data = scanDataCalls(slice, new Map([...topConsts, ...moduleConsts(slice)]));
      for (const n of data.from) u.from.add(n);
      for (const n of data.rpc) u.rpc.add(n);
      for (const ident of data.unresolved) diagnostics.push(`${rel}: .from(${ident}) — identifier not resolvable file-locally`);
      for (const t of scanSubscriptions(slice, subscribeCalls)) u.subs.add(t);
      const shadowed = st.mentions.size ? boundInside(mask.slice(st.start, st.end), st.names) : new Set();
      for (const id of st.mentions) {
        if (shadowed.has(id)) continue;
        for (const j of mod.decls.get(id) ?? []) if (unitOf[j] !== null) u.refers.add(unitOf[j]);
      }
    });
    const entries = [...units.values()];
    const own = (u) => new Set([...[...u.from].map((n) => `f:${n}`), ...[...u.rpc].map((n) => `r:${n}`), ...[...u.subs].map((n) => `s:${n}`)]);
    // Past the closure's bound (a pathological file), each function keeps
    // its own calls only, and derive says so on every run (CR-050).
    const closedOrOwn = (closed, list, own) => {
      if (closed) return closed;
      warnings.push(`${rel}: too many same-file calls to follow (over ${MAX_CLOSED} function-to-table links) — each function's own data access is kept, its helpers' are not`);
      return new Map(list.map((e) => [e.name, own(e)]));
    };
    const closed = closedOrOwn(closeOver(entries, own), entries, own);
    for (const u of entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      const tagged = [...closed.get(u.name)];
      if (!tagged.length) continue;
      const pick = (tag, prefix) => tagged.filter((t) => t.startsWith(tag)).map((t) => `${prefix}${t.slice(2)}`);
      const subscribes = [...new Set(pick("s:", "?table:"))].sort();
      const refs = new Set([...pick("f:", "?from:"), ...pick("r:", "?function:"), ...subscribes]);
      records.push(dataAccessRecord("supabase-js", rel, { name: u.name, docstring: commentAbove(u.start) }, refs, subscribes.length ? { subscribes } : undefined));
    }
  }
  return { records, diagnostics, warnings };
}
