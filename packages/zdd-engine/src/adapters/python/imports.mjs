// The Python import reader (ZDD-10, decision 0046): which repo files one
// file imports, for the blessing index's "used by" of an `extend` blessing.
// Every Python adapter exports it as `IMPORTS`; the core asks the repo's
// configured adapters for their readers, walks the source once and inverts
// the answer.
//
// Read on the masked text (adapters/python), logical lines joined, so an
// import in a comment or a string is not one: `import a.b [as c], d` and
// `from [.]*a.b import x, (y, z)`. Resolution, as the interpreter runs it:
//   relative     one dot is the file's own folder, each further dot one up
//   absolute     from the nearest folder above the importing file that
//                holds the first name as a package (a folder) or a module
//                (`<name>.py`) — the folder a service is run from
//   a package    is its `__init__.py`, and importing `a.b.c` runs every
//                package on the way (`a/__init__.py`, `a/b/__init__.py`)
//   `from m import x`  also names `m/x.py` (or `m/x/__init__.py`) when x is
//                a submodule
// A module from outside the repo resolves to nothing. Deterministic: the
// answer depends only on the files handed in and their bytes.

import { posix } from "node:path";
import { masked } from "./source.mjs";

const LOGICAL_MAX_LINES = 200;

// Test code is a user only of test code (a fixture, a conftest helper).
const isTest = (rel) => /(^|\/)(tests?|__tests__)\//.test(rel) || /(^|\/)(test_[^/]*|[^/]*_test|conftest)\.py$/.test(rel);

// The import statements of a file: [{ module, names }] — `module` dotted,
// relative ones keeping their leading dots; `names` the imported members
// of a `from` (empty for a plain `import`).
export function importStatements(text) {
  const code = masked(text);
  const out = [];
  let parts = [];
  let depth = 0;
  const flush = () => {
    const line = parts.join(" ");
    parts = [];
    depth = 0;
    const plain = /^\s*import\s+(.+)$/.exec(line);
    if (plain) {
      for (const part of plain[1].split(",")) {
        const m = /^\s*([A-Za-z_][\w.]*)(?:\s+as\s+\w+)?\s*$/.exec(part);
        if (m) out.push({ module: m[1], names: [] });
      }
      return;
    }
    const from = /^\s*from\s+(\.*[\w.]*)\s+import\s+\(?([^)]*)\)?\s*$/.exec(line);
    if (from && from[1]) out.push({ module: from[1], names: from[2].split(",").map((s) => /^\s*(\w+)/.exec(s)?.[1]).filter((n) => n && n !== "as") });
  };
  for (const raw of code.split("\n")) {
    // A statement after a `;` or a `:` on one line is rare; the line's own
    // first statement is what matters here.
    parts.push(parts.length ? raw.trim() : raw);
    depth += (raw.match(/\(/g) ?? []).length - (raw.match(/\)/g) ?? []).length;
    const continued = /\\\s*$/.test(raw);
    if (continued) parts[parts.length - 1] = parts[parts.length - 1].replace(/\\\s*$/, "");
    if ((depth > 0 || continued) && parts.length < LOGICAL_MAX_LINES) continue;
    flush();
  }
  if (parts.length) flush();
  return out;
}

export function resolver(io, files = null) {
  const all = files ?? walkAll(io);
  const has = new Set(all);
  const dirs = new Set();
  for (const f of all) for (let d = posix.dirname(f); d !== "."; d = posix.dirname(d)) dirs.add(d);
  const at = (base, segs) => (base ? `${base}/${segs.join("/")}` : segs.join("/"));
  // The file a dotted path names under `base`, plus every package on the
  // way; null when the last name is neither a module nor a package.
  const chain = (base, segs) => {
    const out = [];
    for (let k = 1; k < segs.length; k++) {
      const init = `${at(base, segs.slice(0, k))}/__init__.py`;
      if (has.has(init)) out.push(init);
    }
    const mod = `${at(base, segs)}.py`;
    const pkg = `${at(base, segs)}/__init__.py`;
    if (has.has(mod)) out.push(mod);
    else if (has.has(pkg)) out.push(pkg);
    else if (!dirs.has(at(base, segs))) return null;
    return out;
  };
  // The folder an absolute import starts from: the nearest one above the
  // importing file that holds its first name.
  const rootFor = (dir, first) => {
    for (let d = dir; ; d = posix.dirname(d) === "." ? "" : posix.dirname(d)) {
      if (dirs.has(at(d, [first])) || has.has(`${at(d, [first])}.py`)) return d;
      if (d === "") return null;
    }
  };
  return (rel, text) => {
    const dir = posix.dirname(rel) === "." ? "" : posix.dirname(rel);
    const out = new Set();
    for (const { module, names } of importStatements(text)) {
      let base;
      let segs;
      const dots = /^\.*/.exec(module)[0].length;
      if (dots) {
        const up = dir.split("/").filter(Boolean);
        if (dots - 1 > up.length) continue;
        base = up.slice(0, up.length - (dots - 1)).join("/");
        segs = module.slice(dots).split(".").filter(Boolean);
      } else {
        segs = module.split(".");
        base = rootFor(dir, segs[0]);
        if (base === null) continue;
      }
      const found = segs.length ? chain(base, segs) : [has.has(base ? `${base}/__init__.py` : "__init__.py") ? (base ? `${base}/__init__.py` : "__init__.py") : null].filter(Boolean);
      if (found === null) continue;
      for (const f of found) out.add(f);
      for (const n of names) {
        const sub = chain(base, [...segs, n]);
        if (sub && sub.length && (has.has(`${at(base, [...segs, n])}.py`) || has.has(`${at(base, [...segs, n])}/__init__.py`))) for (const f of sub) out.add(f);
      }
    }
    out.delete(rel);
    return [...out].sort();
  };
}

function walkAll(io) {
  const out = [];
  io.walk(".", (rel) => out.push(rel), { enter: (_rel, name) => !SKIP_DIRS.includes(name) });
  return out;
}

// Folders of installed or cached code: never source.
const SKIP_DIRS = [".git", ".venv", "venv", "__pycache__", ".tox", ".mypy_cache", ".pytest_cache", "site-packages"];

export const IMPORTS = { label: "Python", extensions: [".py"], skipDirs: SKIP_DIRS, isTest, resolver };
