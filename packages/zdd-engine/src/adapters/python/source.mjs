// Python source helpers shared by the Python adapters (fastapi, supabase-py,
// sqlalchemy). This folder has no index.mjs, so it is not an adapter
// (decision 0036): it is how the adapters agree, byte for byte, on what a
// function is, so a route adapter's `?code:<file>#<name>` and a data-access
// adapter's record for the same function name the same text (decision 0037).
//
// Purely textual, line-oriented, no Python parsing:
//   defs(text)            every `def` / `async def`, at any indent: its name,
//                         its line, and its body — the lines after the def
//                         line that are blank or indented deeper than it
//                         (the rule the fastapi adapter has always used).
//                         Two defs with one name in a file are one entry,
//                         their bodies joined (a method `get` on two classes
//                         is attributed to both: refs err toward might-touch,
//                         decision 0011).
//   masked(text)          the text with comments and string contents blanked
//                         to spaces, quotes kept, lengths kept — call sites
//                         are found on this, so a call spelled in a string or
//                         a comment is not one.
//   strings(text)         every string literal's contents, in order: single,
//                         double, and triple-quoted, with r/b/u/f prefixes
//                         (an f-string's text is read as written).
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
//   dataAccessRecord(adapter, rel, fn, refs, edges)
//                         the `data-access` record every Python data-access
//                         adapter mints for one function.
//   resolveModule(rel, module, byModule)
//                         the one scanned file a module path names, seen from
//                         `rel`, or null when none or several do (ambiguous
//                         is skipped, never guessed).

import { slugify } from "../../core/lib/slug.mjs";

// The directories a Python walk skips unless the adopter says otherwise.
export const DEFAULT_EXCLUDE_DIRS = ["node_modules", ".venv", "venv", "__pycache__", ".git", "tests", "test"];

export function defs(text) {
  const lines = text.split("\n");
  const out = new Map();
  for (let i = 0; i < lines.length; i++) {
    const def = /^(\s*)(?:async\s+)?def\s+(\w+)\s*\(/.exec(lines[i]);
    if (!def) continue;
    const body = defBody(lines, i, def[1].length);
    const doc = /^\s*(?:r?"""|r?''')\s*([^\n"']*)/.exec(body);
    const prev = out.get(def[2]);
    if (prev) prev.body += `\n${body}`;
    else out.set(def[2], { name: def[2], line: i + 1, body, docstring: doc ? doc[1].trim() : "" });
  }
  return [...out.values()];
}

// The body of the def on line `i` (indent `indent`): the lines after its
// signature that are blank or indented deeper. A signature may run over
// several lines and close back at the def's own indent (`) -> dict:`), so the
// header ends at the first line where the parentheses balance; before this,
// such a def's body stopped at its closing `)` and read as empty.
export function defBody(lines, i, indent) {
  let header = i;
  let depth = 0;
  for (let k = i; k < lines.length; k++) {
    const code = masked(lines[k]);
    depth += (code.match(/[([{]/g) ?? []).length - (code.match(/[)\]}]/g) ?? []).length;
    header = k;
    if (depth <= 0) break;
  }
  let end = header + 1;
  while (end < lines.length && (lines[end].trim() === "" || lines[end].search(/\S/) > indent)) end++;
  return lines.slice(header + 1, end).join("\n");
}

// One scan over the text, telling code from strings and comments. `onString`
// gets each literal's contents and its span; the masked text is returned.
function walkSource(text, onString = () => {}) {
  let out = "";
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
    const prefix = /^[rRbBuUfF]{0,2}(?:'''|"""|'|")/.exec(text.slice(i, i + 5));
    const startsWord = i === 0 || !/\w/.test(text[i - 1]);
    const quoteOf = (p) => (p.endsWith('"""') || p.endsWith("'''") ? p.slice(-3) : p.slice(-1));
    // A letter prefix (r, b, f, rb, …) counts only at the start of a token:
    // `verb'…` is an identifier then a quote, not a bytes literal.
    if (prefix && (prefix[0].length === quoteOf(prefix[0]).length || startsWord)) {
      const p = prefix[0];
      const quote = quoteOf(p);
      const raw = /[rR]/.test(p.slice(0, -quote.length));
      const open = i + p.length;
      let j = open;
      while (j < text.length) {
        if (!raw && text[j] === "\\") {
          j += 2;
          continue;
        }
        if (text.startsWith(quote, j)) break;
        if (quote.length === 1 && text[j] === "\n") break; // an unterminated one-line string ends at the line
        j++;
      }
      const close = Math.min(j, text.length);
      onString(text.slice(open, close), open, close);
      out += p + text.slice(open, close).replace(/[^\n]/g, " ") + (text.startsWith(quote, close) ? quote : "");
      i = text.startsWith(quote, close) ? close + quote.length : close;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

export function masked(text) {
  return walkSource(text);
}

export function strings(text) {
  const out = [];
  walkSource(text, (s) => out.push(s));
  return out;
}

export function imports(text) {
  const out = new Map();
  // Join continued and parenthesised import lists into one logical line.
  const code = masked(text);
  const logical = [];
  let buf = "";
  let depth = 0;
  for (const line of code.split("\n")) {
    buf = buf ? `${buf} ${line.trim()}` : line;
    depth += (line.match(/\(/g) ?? []).length - (line.match(/\)/g) ?? []).length;
    if (depth > 0 || /\\\s*$/.test(line)) {
      buf = buf.replace(/\\\s*$/, "");
      continue;
    }
    logical.push(buf);
    buf = "";
    depth = 0;
  }
  if (buf) logical.push(buf);
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

// A data-access record, shaped the same by every Python data-access adapter.
// The id is namespaced by the adapter (`data-access:supabase-py/<file>#<fn>`,
// as a table is `table:db/<name>`), so two adapters that both read one
// function mint two records; `?code:<file>#<fn>` reaches both (decision 0037).
export function dataAccessRecord(adapter, rel, fn, refs, edges) {
  return {
    kind: "data-access",
    id: `data-access:${adapter}/${rel}#${fn.name}`,
    title: `${fn.name} (${rel})`,
    description: fn.docstring,
    resource: [rel],
    refs: [...refs].sort(),
    facts: { function: fn.name, ...(edges ? { edges } : {}) },
    filename: `${adapter}--${slugify(rel)}--${fn.name}.json`,
    requireRefs: true,
  };
}
