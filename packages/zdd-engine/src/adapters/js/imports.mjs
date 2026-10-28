// The JavaScript / TypeScript import reader (ZDD-10, decision 0046): which
// repo files one file imports, as the language's own resolution finds them,
// for the blessing index's "used by" of an `extend` blessing. Every JS
// adapter exports it as `IMPORTS`; the core asks the repo's configured
// adapters for their readers, walks the source once and inverts the answer.
//
// A specifier is read where the code says it — `import … from`, a bare
// `import "x"`, `export … from`, `require("x")`, `import("x")` — on the
// lexical mask, so one spelled in a comment or a string is not one. A
// type-only import counts: the importer is checked against the types.
// Resolution, in the order the toolchain uses:
//   ./ and ../          from the importing file's folder
//   tsconfig `paths`    the nearest tsconfig.json / jsconfig.json above the
//                       file (comments and trailing commas allowed), its
//                       relative `extends` followed, `paths` under `baseUrl`
//                       (else the declaring file's folder), the longest
//                       matching pattern first, one `*`
//   workspace packages  a package.json `name` in the repo, its `exports`
//                       ("." and "./sub", one `*`; conditions in the
//                       manifest's order, those active for an import or a
//                       require; a target not in the repo passed over) or
//                       `main`, else the folder's index
// then the file as named, with each extension, as a folder's index; from a
// TypeScript file a `.js` names its `.ts` first (ESM TypeScript). A
// backslash in a config's path is a separator. A package from outside the
// repo resolves to nothing. Deterministic: the answer depends only on the
// files handed in and their bytes.

import { posix } from "node:path";
import { lex } from "./source.mjs";

const EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"];
const PROBE = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"];
const TS_FOR_JS = { ".js": [".ts", ".tsx"], ".jsx": [".tsx"], ".mjs": [".mts"], ".cjs": [".cts"] };
const TS_FAMILY = /\.[cm]?tsx?$/;
// The conditions a toolchain resolving this file would have on, by how the
// specifier was written (TypeScript adds `types`; bundlers `browser` and
// `module`). An object's keys are tried in the manifest's order.
const ACTIVE = {
  import: new Set(["types", "import", "module", "browser", "node", "development", "production", "default"]),
  require: new Set(["types", "require", "browser", "node", "development", "production", "default"]),
};
// A guard on an `extends` loop, never a depth a real repo reaches.
const MAX_EXTENDS = 64;

// Test code is a user only of test code (a fixture, a helper): changing a
// shared module means retesting the code that runs it, which its tests do.
const isTest = (rel) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(rel) || /\.d\.[cm]?ts$/.test(rel) || /(^|\/)(__tests__|__mocks__|e2e|tests?)\//.test(rel);

const SPECIFIERS = [
  /\b(import|export)\s+(?:type\s+)?[^'";]*?\bfrom\s*(['"])([^'"\n]+)\2/g,
  /\b(import)\s*(['"])([^'"\n]+)\2/g,
  /\b(require|import)\s*\(\s*(['"])([^'"\n]+)\2\s*\)/g,
];

// [{ spec, mode }]: each specifier once per mode, `require` for a
// `require("x")`, `import` for every other form.
export function specifiers(text) {
  const { code, mask } = lex(text);
  const out = new Map();
  for (const re of SPECIFIERS) {
    for (const m of code.matchAll(re)) {
      // The keyword itself must be code, not the body of a string.
      if (mask.slice(m.index, m.index + m[1].length) !== m[1]) continue;
      if (m.index > 0 && /[\w$.]/.test(code[m.index - 1])) continue;
      const mode = m[1] === "require" ? "require" : "import";
      out.set(`${mode}\0${m[3]}`, { spec: m[3], mode });
    }
  }
  return [...out.values()];
}

// A tsconfig is JSON with comments and trailing commas.
function parseJsonc(text) {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
    } else if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end === -1 ? text.length : end + 2;
    } else {
      out += c;
      i++;
    }
  }
  try {
    return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
  } catch {
    return null;
  }
}

const norm = (p) => {
  const n = posix.normalize(p);
  return n === "." ? "" : n.replace(/^\.\//, "");
};
const inside = (p) => p !== ".." && !p.startsWith("../") && !posix.isAbsolute(p);
// A config written on Windows may spell a path with backslashes.
const slash = (p) => p.replace(/\\/g, "/");

// `files`: every file of the repo (repo-relative, POSIX), the walk the core
// made; `read(rel)` returns a file's text or null.
export function resolver(io, files = null) {
  const all = files ?? walkAll(io);
  const has = new Set(all);
  const read = (rel) => {
    const r = io.read(rel);
    return r.ok ? r.text : null;
  };
  // From a TypeScript file, `./x.js` names `x.ts` first (TypeScript's
  // extension substitution), and the `.js` only when no source stands in.
  const probe = (p, tsFirst = false) => {
    if (!inside(p)) return null;
    const ext = posix.extname(p);
    const substitute = () => {
      for (const e of TS_FOR_JS[ext] ?? []) if (has.has(p.slice(0, -ext.length) + e)) return p.slice(0, -ext.length) + e;
      return null;
    };
    if (tsFirst) {
      const s = substitute();
      if (s) return s;
    }
    if (has.has(p)) return p;
    for (const e of PROBE) if (has.has(p + e)) return p + e;
    for (const e of PROBE) if (has.has(`${p}/index${e}`)) return `${p}/index${e}`;
    return substitute();
  };

  // tsconfig per folder, nearest first, with its `extends` merged.
  const configCache = new Map();
  // As TypeScript merges them: `paths` resolve under the effective
  // `baseUrl` (a child's overrides an inherited one, inherited paths and
  // all), else under the folder of the config that declared them.
  const loadConfig = (rel, seen = new Set()) => {
    if (seen.has(rel) || seen.size > MAX_EXTENDS) return null;
    seen.add(rel);
    const text = read(rel);
    const json = text === null ? null : parseJsonc(text);
    if (!json || typeof json !== "object") return null;
    const dir = posix.dirname(rel) === "." ? "" : posix.dirname(rel);
    let base = { paths: null, pathsDir: null, baseUrl: null };
    if (typeof json.extends === "string" && json.extends.startsWith(".")) {
      let parent = norm(posix.join(dir || ".", slash(json.extends)));
      if (!parent.endsWith(".json")) parent += ".json";
      base = loadConfig(parent, seen) ?? base;
    }
    const co = json.compilerOptions ?? {};
    const own = co.paths && typeof co.paths === "object" && !Array.isArray(co.paths);
    const baseUrl = typeof co.baseUrl === "string" ? norm(posix.join(dir || ".", slash(co.baseUrl))) : base.baseUrl;
    const paths = own ? co.paths : base.paths;
    const pathsDir = own ? dir : base.pathsDir;
    return { paths, pathsDir, baseUrl, pathsBase: baseUrl ?? pathsDir };
  };
  const configFor = (dir) => {
    if (configCache.has(dir)) return configCache.get(dir);
    let found = null;
    for (const name of ["tsconfig.json", "jsconfig.json"]) {
      const rel = dir ? `${dir}/${name}` : name;
      if (has.has(rel)) {
        found = loadConfig(rel);
        break;
      }
    }
    if (!found && dir) found = configFor(posix.dirname(dir) === "." ? "" : posix.dirname(dir));
    configCache.set(dir, found);
    return found;
  };
  const viaPaths = (spec, dir, tsFirst) => {
    const c = configFor(dir);
    if (!c?.paths) return null;
    // An exact key first, then the pattern with the longest prefix
    // (TypeScript's order).
    const keys = Object.keys(c.paths)
      .filter((k) => (k.includes("*") ? spec.startsWith(k.slice(0, k.indexOf("*"))) && spec.endsWith(k.slice(k.indexOf("*") + 1)) && spec.length >= k.length - 1 : k === spec))
      .sort((a, b) => (a.includes("*") ? 1 : 0) - (b.includes("*") ? 1 : 0) || b.indexOf("*") - a.indexOf("*") || (a < b ? -1 : 1));
    for (const k of keys) {
      const star = k.includes("*") ? spec.slice(k.indexOf("*"), spec.length - (k.length - k.indexOf("*") - 1)) : "";
      for (const target of Array.isArray(c.paths[k]) ? c.paths[k] : []) {
        if (typeof target !== "string") continue;
        const hit = probe(norm(posix.join(c.pathsBase || ".", slash(target).replace("*", star))), tsFirst);
        if (hit) return hit;
      }
    }
    return null;
  };

  // Workspace packages by name.
  let packages = null;
  const packageFor = (spec) => {
    if (!packages) {
      packages = [];
      for (const rel of all) {
        if (rel !== "package.json" && !rel.endsWith("/package.json")) continue;
        const text = read(rel);
        let json = null;
        try {
          json = text === null ? null : JSON.parse(text);
        } catch {
          /* not a manifest */
        }
        if (json && typeof json.name === "string") packages.push({ name: json.name, dir: posix.dirname(rel) === "." ? "" : posix.dirname(rel), json });
      }
      packages.sort((a, b) => b.name.length - a.name.length || (a.dir < b.dir ? -1 : 1));
    }
    return packages.find((p) => spec === p.name || spec.startsWith(`${p.name}/`)) ?? null;
  };
  // The repo file an exports target names, by the conditions active for
  // `mode`, keys in the manifest's order. A target that is not in the repo
  // (built output, which git ignores) is passed over, so a branch naming
  // the source (a custom `source` condition) is taken when no active one
  // resolves.
  const pick = (v, mode, dir, star, tsFirst, anyCondition = false) => {
    if (typeof v === "string") return probe(norm(posix.join(dir || ".", slash(v).replace("*", star))), tsFirst);
    if (Array.isArray(v)) {
      for (const x of v) {
        const s = pick(x, mode, dir, star, tsFirst, anyCondition);
        if (s) return s;
      }
      return null;
    }
    if (v && typeof v === "object") {
      for (const k of Object.keys(v)) {
        if (!anyCondition && !ACTIVE[mode].has(k)) continue;
        const s = pick(v[k], mode, dir, star, tsFirst, anyCondition);
        if (s) return s;
      }
      if (!anyCondition) return pick(v, mode, dir, star, tsFirst, true);
    }
    return null;
  };
  const viaPackage = (spec, mode, tsFirst) => {
    const pkg = packageFor(spec);
    if (!pkg) return null;
    const sub = spec === pkg.name ? "." : `.${spec.slice(pkg.name.length)}`;
    let exp = pkg.json.exports;
    if (exp !== undefined && exp !== null) {
      if (typeof exp === "string" || Array.isArray(exp) || typeof exp !== "object" || !Object.keys(exp).some((k) => k.startsWith("."))) exp = { ".": exp };
      if (Object.hasOwn(exp, sub)) return pick(exp[sub], mode, pkg.dir, "", tsFirst);
      for (const k of Object.keys(exp).filter((x) => x.includes("*")).sort((a, b) => b.indexOf("*") - a.indexOf("*") || (a < b ? -1 : 1))) {
        const [pre, post] = [k.slice(0, k.indexOf("*")), k.slice(k.indexOf("*") + 1)];
        if (sub.startsWith(pre) && sub.endsWith(post) && sub.length >= pre.length + post.length) return pick(exp[k], mode, pkg.dir, sub.slice(pre.length, sub.length - post.length), tsFirst);
      }
      return null;
    }
    const at = (p) => norm(posix.join(pkg.dir || ".", p));
    if (sub === ".") return (typeof pkg.json.main === "string" ? probe(at(slash(pkg.json.main)), tsFirst) : null) ?? probe(at("index"), tsFirst);
    return probe(at(sub), tsFirst);
  };

  return (rel, text) => {
    const dir = posix.dirname(rel) === "." ? "" : posix.dirname(rel);
    const out = new Set();
    const tsFirst = TS_FAMILY.test(rel);
    for (const { spec, mode } of specifiers(text)) {
      let hit = null;
      if (spec.startsWith("./") || spec.startsWith("../") || spec === "." || spec === "..") hit = probe(norm(posix.join(dir || ".", spec)), tsFirst);
      else if (!spec.startsWith("/") && !/^[a-z]+:/i.test(spec)) hit = viaPaths(spec, dir, tsFirst) ?? viaPackage(spec, mode, tsFirst);
      if (hit && hit !== rel) out.add(hit);
    }
    return [...out].sort();
  };
}

function walkAll(io) {
  const out = [];
  io.walk(".", (rel) => out.push(rel), { enter: (_rel, name) => !SKIP_DIRS.includes(name) });
  return out;
}

// Folders of installed or built code: never source.
const SKIP_DIRS = [".git", "node_modules", ".next", ".expo", "dist", "build", "coverage", ".turbo", ".vercel"];

export const IMPORTS = { label: ["JavaScript", "TypeScript"], extensions: EXTENSIONS, skipDirs: SKIP_DIRS, isTest, resolver };
