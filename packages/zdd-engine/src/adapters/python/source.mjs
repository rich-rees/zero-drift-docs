// Python source helpers shared by the Python adapters (fastapi, supabase-py,
// sqlalchemy). This folder has no index.mjs, so it is not an adapter
// (decision 0036): it is how the adapters agree, byte for byte, on what a
// function is, so a route adapter's `?code:<file>#<name>` and a data-access
// adapter's record for the same function name the same text (decision 0037).
//
// Textual, no Python parsing, but one lexer: comments, strings and f-strings
// are told from code once per file, so a `def` or a call spelled in a
// docstring is never one, and a call inside an f-string's `{…}` is.
//
//   masked(text)          the text with comments and string contents blanked
//                         to spaces, quotes kept, length and newlines kept; an
//                         f-string's `{expression}` stays code. Call sites and
//                         defs are found on this.
//   strings(text)         every string literal's contents as written, in
//                         order: single, double, triple-quoted, with r/b/u/f
//                         prefixes. A backslash keeps a quote from ending a
//                         raw string too, as in Python.
//   defs(text)            every `def` / `async def` at any indent, one entry
//                         per name (two defs with one name are joined: a
//                         method `get` on two classes is attributed to both,
//                         decision 0011). An entry holds the function's OWN
//                         body — after its signature (which may run over
//                         several lines), plus a one-line suite after the
//                         colon, minus any nested def, which is an entry of
//                         its own — its docstring (the first line of a leading
//                         string literal), its parameters and its plain local
//                         bindings, and the same-file functions it refers to
//                         by name (called, or passed as a callback).
//   closeOver(entries, own)
//                         name -> own(entry) united with own() of every
//                         same-file function it reaches through those
//                         references, transitively (linear, cycles once).
//   imports(text)         the file's imports as name -> { module, member }:
//                         `import a.b as x` -> x: { module: "a.b" };
//                         `from a.b import c` / `as d` -> c|d: { module: "a.b",
//                         member: "c" } — c may be a module or a function, and
//                         the caller decides which. Relative modules keep
//                         their dots (`.repositories`). Parenthesised and
//                         backslash-continued lists are read.
//   pythonFiles(io, roots, excludeDirs, diagnostics)
//                         the .py files under the roots, through io (never a
//                         gitignored path), sorted and de-duplicated.
//   moduleFiles(files)    module basename -> [files], for resolving a module
//                         path to one scanned file.
//   resolveModule(rel, module, byModule)
//                         the one scanned file a module path names, seen from
//                         `rel`, or null when none or several do (ambiguous
//                         is skipped, never guessed).
//   dataAccessRecord(adapter, rel, fn, refs, edges)
//                         the `data-access` record every Python data-access
//                         adapter mints for one function.
//
// Malformed input stays linear: a signature that never closes is read as its
// def line alone after HEADER_MAX_LINES lines, and an import list that never
// closes stops joining after LOGICAL_MAX_LINES.

import { slugify } from "../../core/lib/slug.mjs";

// The directories a Python walk skips unless the adopter says otherwise.
export const DEFAULT_EXCLUDE_DIRS = ["node_modules", ".venv", "venv", "__pycache__", ".git", "tests", "test"];

const HEADER_MAX_LINES = 64;
const LOGICAL_MAX_LINES = 256;

// ---- the lexer ----

function lex(text) {
  let out = "";
  const literals = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === "#") {
      const nl = text.indexOf("\n", i);
      const end = nl === -1 ? text.length : nl;
      out += " ".repeat(end - i);
      i = end;
      continue;
    }
    const m = /^([rRbBuUfF]{0,2})('''|"""|'|")/.exec(text.slice(i, i + 5));
    // A letter prefix (r, b, f, rb, …) counts only at the start of a token:
    // `verb'…` is an identifier then a quote, not a bytes literal.
    if (m && (m[1] === "" || i === 0 || !/\w/.test(text[i - 1]))) {
      const quote = m[2];
      const f = /[fF]/.test(m[1]);
      const open = i + m[0].length;
      let j = open;
      let body = "";
      while (j < text.length) {
        const ch = text[j];
        if (ch === "\\") {
          // An escape keeps the next character from ending the literal, raw
          // or not; a backslash-newline keeps its newline.
          body += " " + (text[j + 1] === "\n" ? "\n" : j + 1 < text.length ? " " : "");
          j += 2;
          continue;
        }
        if (f && ch === "{") {
          if (text[j + 1] === "{") {
            body += "  ";
            j += 2;
            continue;
          }
          let k = j + 1;
          let depth = 1;
          for (; k < text.length; k++) {
            if (text[k] === "{") depth++;
            else if (text[k] === "}" && --depth === 0) break;
            else if (quote.length === 1 && text[k] === "\n") break;
          }
          const closed = text[k] === "}";
          body += " " + text.slice(j + 1, k) + (closed ? " " : "");
          j = closed ? k + 1 : k;
          continue;
        }
        if (text.startsWith(quote, j)) break;
        if (quote.length === 1 && ch === "\n") break; // an unterminated one-line string ends at the line
        body += ch === "\n" ? "\n" : " ";
        j++;
      }
      const close = Math.min(j, text.length);
      literals.push({ value: text.slice(open, close), start: i, open });
      const closed = text.startsWith(quote, close);
      out += m[0] + body.slice(0, close - open) + (closed ? quote : "");
      i = closed ? close + quote.length : close;
      continue;
    }
    out += c;
    i++;
  }
  return { mask: out, literals };
}

export function masked(text) {
  return lex(text).mask;
}

export function strings(text) {
  return lex(text).literals.map((l) => l.value);
}

// ---- functions ----

const indentOf = (line) => line.search(/\S/);

// Every def, unmerged, with its span: { name, line, indent, headerEnd, end, colon }.
function scanDefs(lines, maskLines) {
  const found = [];
  const open = []; // the defs whose body line i may be in, innermost last
  for (let i = 0; i < maskLines.length; i++) {
    const d = /^(\s*)(?:async\s+)?def\s+(\w+)\s*\(/.exec(maskLines[i]);
    if (!d) continue;
    const indent = d[1].length;
    // The header: from the def line until the brackets balance and a colon
    // closes it. Bounded: a signature that never closes is its def line.
    let headerEnd = i;
    let colon = -1;
    let depth = 0;
    let seenOpen = false;
    scan: for (let k = i; k < maskLines.length && k < i + HEADER_MAX_LINES; k++) {
      if (k > i && /^\s*(?:async\s+)?def\s+\w+\s*\(/.test(maskLines[k]) && indentOf(maskLines[k]) <= indent) break;
      const line = maskLines[k];
      for (let p = k === i ? d[0].length - 1 : 0; p < line.length; p++) {
        const ch = line[p];
        if (ch === "(" || ch === "[" || ch === "{") {
          depth++;
          seenOpen = true;
        } else if (ch === ")" || ch === "]" || ch === "}") depth--;
        else if (ch === ":" && depth === 0 && seenOpen) {
          headerEnd = k;
          colon = p;
          break scan;
        }
      }
    }
    let end = headerEnd + 1;
    while (end < maskLines.length && (maskLines[end].trim() === "" || indentOf(maskLines[end]) > indent)) end++;
    // The innermost def this one sits in the body of, if any: a nested def's
    // full name is its parent's plus its own (`_add.work`), so two helpers'
    // nested `work` callbacks are two functions (decision 0037 as built).
    while (open.length && !(i > open[open.length - 1].headerEnd && i < open[open.length - 1].end)) open.pop();
    const parent = open[open.length - 1] ?? null;
    const def = { name: d[2], qual: parent ? `${parent.qual}.${d[2]}` : d[2], parent, line: i, indent, headerEnd, end, colon };
    found.push(def);
    open.push(def);
  }
  return found;
}

const DOC_START = /^\s*[rRuUbB]{0,2}("""|'''|"|')/;

function docstringOf(body, bodyMask) {
  const first = bodyMask.split("\n").find((l) => l.trim() !== "");
  if (!first || !DOC_START.test(first)) return "";
  const lit = lex(body).literals[0];
  if (!lit) return "";
  const line = lit.value.split("\n").find((l) => l.trim() !== "");
  return line ? line.trim() : "";
}

const IDENT = /[A-Za-z_]\w*/g;
function paramsOf(maskLines, d) {
  const header = maskLines.slice(d.line, d.headerEnd + 1).join("\n");
  const open = header.indexOf("(");
  const out = new Set();
  if (open === -1) return out;
  let depth = 0;
  let seg = "";
  const segs = [];
  for (let p = open + 1; p < header.length; p++) {
    const ch = header[p];
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    if (ch === ")" || ch === "]" || ch === "}") {
      if (depth === 0) break;
      depth--;
    }
    if (ch === "," && depth === 0) {
      segs.push(seg);
      seg = "";
    } else seg += ch;
  }
  segs.push(seg);
  for (const s of segs) {
    const m = /^\s*\*{0,2}\s*([A-Za-z_]\w*)/.exec(s);
    if (m) out.add(m[1]);
  }
  return out;
}

// Plain local bindings: `name = …` / `name: T = …` at bracket depth 0 (a
// keyword argument on its own line inside a call is not one), a `for name
// in`, and `with … as name` / `except … as name`. An import inside the body
// is not a local binding: it is in the file's import map and resolves.
function localsOf(bodyMask) {
  const out = new Set();
  let depth = 0;
  for (const line of bodyMask.split("\n")) {
    if (depth === 0) {
      const m = /^[ \t]*([A-Za-z_]\w*)\s*(?::[^=\n]*)?=(?!=)/.exec(line);
      if (m) out.add(m[1]);
    }
    depth = Math.max(0, depth + (line.match(/[([{]/g) ?? []).length - (line.match(/[)\]}]/g) ?? []).length);
  }
  for (const m of bodyMask.matchAll(/\bfor\s+([A-Za-z_]\w*)\s+in\b/g)) out.add(m[1]);
  for (const m of bodyMask.matchAll(/\b(?:with|except)\b[^\n]*?\bas\s+([A-Za-z_]\w*)/g)) out.add(m[1]);
  return out;
}

export function defs(text) {
  const lines = text.split("\n");
  const maskLines = lex(text).mask.split("\n");
  const found = scanDefs(lines, maskLines);
  const names = new Set(found.map((d) => d.name));
  const quals = new Set(found.map((d) => d.qual));
  const out = new Map();
  const byLine = new Map();
  found.forEach((d, idx) => {
    // Own lines: the suite after the colon on the header's last line, then the
    // body lines, minus each directly nested def's span (each is an entry of
    // its own; its own nested defs sit inside its span).
    const nested = [];
    for (let j = idx + 1; j < found.length && found[j].line < d.end; ) {
      const n = found[j];
      if (n.line > d.headerEnd) nested.push(n);
      let k = j + 1;
      while (k < found.length && found[k].line < n.end) k++;
      j = k;
    }
    let cut = 0;
    const keep = (k) => {
      while (cut < nested.length && k >= nested[cut].end) cut++;
      return !(cut < nested.length && k >= nested[cut].line);
    };
    const ownText = [];
    const ownMask = [];
    if (d.colon !== -1 && maskLines[d.headerEnd].slice(d.colon + 1).trim() !== "") {
      ownText.push(lines[d.headerEnd].slice(d.colon + 1));
      ownMask.push(maskLines[d.headerEnd].slice(d.colon + 1));
    }
    for (let k = d.headerEnd + 1; k < d.end; k++) {
      if (!keep(k)) continue;
      ownText.push(lines[k]);
      ownMask.push(maskLines[k]);
    }
    const body = ownText.join("\n");
    const bodyMask = ownMask.join("\n");
    const params = paramsOf(maskLines, d);
    const locals = localsOf(bodyMask);
    const bound = new Set([...params, ...locals]);
    // A name resolves as Python scopes it: a def nested in this function or in
    // one it sits in, innermost first, then a top-level def. A name the
    // function binds itself is a local, not that def.
    const refers = new Set();
    for (const m of bodyMask.matchAll(IDENT)) {
      const name = m[0];
      if (!names.has(name) || bound.has(name)) continue;
      if (bodyMask[m.index - 1] === ".") continue; // obj.name is an attribute, not this file's function
      let hit = null;
      for (let s = d; s && !hit; s = s.parent) if (quals.has(`${s.qual}.${name}`)) hit = `${s.qual}.${name}`;
      if (!hit && quals.has(name)) hit = name;
      if (hit) refers.add(hit);
    }
    const prev = out.get(d.qual);
    if (prev) {
      prev.body += `\n${body}`;
      prev.masked += `\n${bodyMask}`;
      params.forEach((p) => prev.params.add(p));
      locals.forEach((p) => prev.locals.add(p));
      refers.forEach((r) => prev.refers.add(r));
    } else {
      out.set(d.qual, { name: d.qual, short: d.name, line: d.line + 1, body, masked: bodyMask, docstring: docstringOf(body, bodyMask), params, locals, refers });
    }
    byLine.set(d.line + 1, d.qual);
  });
  const entries = [...out.values()];
  // def line (1-based) -> its entry, for an adapter that meets defs line by
  // line (fastapi's decorators); not enumerable, so the array reads as before.
  Object.defineProperty(entries, "byLine", { value: new Map([...byLine].map(([line, qual]) => [line, out.get(qual)])) });
  return entries;
}

// Every def's line (1-based) -> its entry. An entry's `name` is its full name
// (`_add.work` for a nested def; a top-level def's is its own), `short` the
// def's own.
export function defsByLine(entries) {
  return entries.byLine ?? new Map();
}

// Close a per-function set over the same-file references: name -> its own
// set united with every function's it reaches, transitively, each function
// once. Strongly connected functions (mutual recursion) share one result
// (Tarjan's algorithm, iterative), so a long chain or a cycle stays linear in
// the number of functions plus references.
export function closeOver(entries, own) {
  const byName = new Map(entries.map((e) => [e.name, e]));
  const succOf = (n) => [...byName.get(n).refers].filter((r) => byName.has(r));
  const index = new Map();
  const low = new Map();
  const onStack = new Set();
  const stack = [];
  const result = new Map();
  let next = 0;
  const visit = (n) => {
    index.set(n, next);
    low.set(n, next++);
    stack.push(n);
    onStack.add(n);
  };
  for (const start of byName.keys()) {
    if (index.has(start)) continue;
    visit(start);
    const work = [[start, succOf(start), 0]];
    while (work.length) {
      const frame = work[work.length - 1];
      const [v, succ] = frame;
      if (frame[2] < succ.length) {
        const w = succ[frame[2]++];
        if (!index.has(w)) {
          visit(w);
          work.push([w, succOf(w), 0]);
        } else if (onStack.has(w)) low.set(v, Math.min(low.get(v), index.get(w)));
        continue;
      }
      work.pop();
      if (work.length) {
        const u = work[work.length - 1][0];
        low.set(u, Math.min(low.get(u), low.get(v)));
      }
      if (low.get(v) !== index.get(v)) continue;
      // v roots a component: its members share one set; every successor
      // outside it is already closed.
      const members = new Set();
      let w;
      do {
        w = stack.pop();
        onStack.delete(w);
        members.add(w);
      } while (w !== v);
      const set = new Set();
      for (const m of members) {
        for (const x of own(byName.get(m))) set.add(x);
        for (const r of byName.get(m).refers) {
          if (members.has(r) || !result.has(r)) continue;
          for (const x of result.get(r)) set.add(x);
        }
      }
      for (const m of members) result.set(m, set);
    }
  }
  return result;
}

// ---- imports ----

export function imports(text) {
  const out = new Map();
  const code = masked(text);
  const logical = [];
  let parts = [];
  let depth = 0;
  for (const line of code.split("\n")) {
    parts.push(parts.length ? line.trim() : line);
    depth += (line.match(/\(/g) ?? []).length - (line.match(/\)/g) ?? []).length;
    const continued = /\\\s*$/.test(line);
    if ((depth > 0 || continued) && parts.length < LOGICAL_MAX_LINES) {
      if (continued) parts[parts.length - 1] = parts[parts.length - 1].replace(/\\\s*$/, "");
      continue;
    }
    logical.push(parts.join(" "));
    parts = [];
    depth = 0;
  }
  if (parts.length) logical.push(parts.join(" "));
  const NAME = /^[A-Za-z_]\w*$/;
  for (const line of logical) {
    const plain = /^\s*import\s+(.+)$/.exec(line);
    if (plain) {
      for (const part of plain[1].split(",")) {
        const m = /^\s*([\w.]+)(?:\s+as\s+(\w+))?\s*$/.exec(part);
        if (m && m[2]) out.set(m[2], { module: m[1] });
        else if (m && !m[1].includes(".")) out.set(m[1], { module: m[1] });
      }
      continue;
    }
    const from = /^\s*from\s+(\.*[\w.]*)\s+import\s+\(?([^)]*)\)?\s*$/.exec(line);
    if (!from) continue;
    for (const part of from[2].split(",")) {
      const m = /^\s*(\w+)(?:\s+as\s+(\w+))?\s*$/.exec(part);
      if (!m || m[1] === "*" || !NAME.test(m[1])) continue;
      out.set(m[2] ?? m[1], { module: from[1], member: m[1] });
    }
  }
  return out;
}

// ---- files and modules ----

export function pythonFiles(io, roots, excludeDirs, diagnostics) {
  const out = new Set();
  for (const root of roots) {
    const r = io.read(root);
    if (r.ok) {
      if (root.endsWith(".py")) out.add(root);
      continue;
    }
    if (r.code === "missing") {
      diagnostics.push(`${root} not found — nothing to inventory`);
      continue;
    }
    if (r.code === "ignored") {
      diagnostics.push(`${root} is gitignored — not source, not read`);
      continue;
    }
    if (r.code !== "not-regular") {
      diagnostics.push(`${root}: ${r.reason} — skipped`);
      continue;
    }
    const walked = io.walk(root, (rel, name) => {
      if (name.endsWith(".py")) out.add(rel);
    }, { enter: (_rel, name) => name !== ".git" && !excludeDirs.includes(name) });
    if (!walked.exists) diagnostics.push(`${root}: not a directory inside the repo — skipped`);
    for (const s of walked.skipped) diagnostics.push(`${s.path}: ${s.reason} — skipped`);
    if (walked.truncated) diagnostics.push(`${root}: the walk's budget ran out — some files were not read`);
  }
  return [...out].sort();
}

export function moduleFiles(files) {
  const byModule = new Map();
  for (const rel of files) {
    const base = rel.slice(rel.lastIndexOf("/") + 1);
    const mod = base === "__init__.py" ? rel.split("/").slice(-2, -1)[0] : base.replace(/\.py$/, "");
    if (!mod) continue;
    byModule.set(mod, [...(byModule.get(mod) ?? []), rel]);
  }
  return byModule;
}

export function resolveModule(rel, module, byModule) {
  if (!module) return null;
  let dotted = module;
  if (dotted.startsWith(".")) {
    // Relative: one dot is this file's package, each further dot one up.
    const dots = /^\.+/.exec(dotted)[0].length;
    const pkg = rel.split("/").slice(0, -1);
    const up = pkg.slice(0, pkg.length - (dots - 1));
    const rest = dotted.slice(dots);
    dotted = [...up, ...(rest ? rest.split(".") : [])].join(".");
    if (!dotted) return null;
  }
  const parts = dotted.split(".");
  const suffix = `${parts.join("/")}.py`;
  const pkgInit = `${parts.join("/")}/__init__.py`;
  const candidates = (byModule.get(parts[parts.length - 1]) ?? []).filter(
    (c) => c === suffix || c.endsWith(`/${suffix}`) || c === pkgInit || c.endsWith(`/${pkgInit}`),
  );
  // A dotted path names a file path; with no exact suffix match the bare
  // basename is used only when it names exactly one file (as include_router
  // has always resolved it).
  if (candidates.length === 1) return candidates[0];
  if (candidates.length > 1) return null;
  const loose = byModule.get(parts[parts.length - 1]) ?? [];
  return parts.length === 1 && loose.length === 1 ? loose[0] : null;
}

// ---- the record ----

// A data-access record, shaped the same by every Python data-access adapter.
// The id is namespaced by the adapter (`data-access:supabase-py/<file>#<fn>`,
// as a table is `table:db/<name>`), so two adapters that both read one
// function mint two records; `?code:<file>#<fn>` reaches both (decision 0037).
// A source path may hold characters a metadata filename may not (a space, a
// `#`): each is written `~<hex>~`, so a valid path never aborts derive (CR-031).
const FILENAME_SAFE = /[^A-Za-z0-9._~()[\]-]/g;
export function dataAccessRecord(adapter, rel, fn, refs, edges) {
  return {
    kind: "data-access",
    id: `data-access:${adapter}/${rel}#${fn.name}`,
    title: `${fn.name} (${rel})`,
    description: fn.docstring,
    resource: [rel],
    refs: [...refs].sort(),
    facts: { function: fn.name, ...(edges ? { edges } : {}) },
    filename: `${adapter}--${slugify(rel)}--${fn.name}.json`.replace(FILENAME_SAFE, (c) => `~${c.codePointAt(0).toString(16)}~`),
    requireRefs: true,
  };
}
