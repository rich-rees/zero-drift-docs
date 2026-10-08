// components extractor — React and React Native components (CAS-97 item 2,
// ZDD 2.1). One convention, shared by both: a component is an EXPORTED
// function or const whose name starts with a capital letter and whose body
// returns JSX, in a `.tsx` / `.jsx` file, including through `memo(...)` and
// `forwardRef(...)`. Pages and screens stay the routing extractors' (files
// under `pageDirs` are skipped). One record per component:
//   facts.props        [{ name, type, optional }] from an inline props type
//                      or a type/interface declared in the same file
//                      (decision: names and types as written); an imported
//                      props type is recorded by name with `propsFrom`
//   facts.shared       imported by two or more files, or under a shared
//                      folder (`sharedDirs`, default components/ and ui/ at
//                      any depth) — the rule for what reaches the agent index
//                      and what a feature slice may claim
//   facts.usedBy       the files that import it, sorted
//   facts.platforms    ["native", "web"] for a `X.native.tsx` / `X.web.tsx`
//                      pair (one record, both files as resources)
// Edges (decision 0016): `uses` from an importing component to this one,
// `usedBy` from this component to the SURFACE whose element file imports it
// (`?surface:<file>`, resolved by resource after the merge — a surface is
// another extractor's record), `calls` to the API routes its body calls
// (`?route:`, decision 0019's expansion), `reads` for `.from()` / `.rpc()`.
// App membership is not here: the renderer derives it from the map's
// Application pages (decision 0018).
// Options (extractorOptions.components):
//   roots           repo-relative dirs scanned (default ["src"])
//   extensions      default [".tsx", ".jsx"]
//   excludeDirs     default ["node_modules"]; `.git` is always skipped
//   excludeSuffixes default test/story/declaration files
//   pageDirs        folder names whose files are surfaces, not components
//                   (default ["pages", "screens", "app"])
//   sharedDirs      folder names that mark a component shared
//                   (default ["components", "ui"])
//   srcAliasRoot    where the tsconfig `@/` alias points (default: the first
//                   root)
// Purely textual, on the react-router extractor's lexical mask: a component
// spelled inside a comment or a string is not one. Every file is read
// through `io` (decision 0010): inside the repo, under the cap, never
// through a link. Deterministic: same bytes in, same records out.

import { posix } from "node:path";
import { lex, model, localImports, scanApiCalls, scanDataCalls, moduleConsts } from "../react-router/index.mjs";
import { repoRelative } from "../../lib/paths.mjs";

export const FACTS_KEY_ORDER = {
  component: ["name", "export", "props", "propsType", "propsFrom", "shared", "sharedBy", "usedBy", "platforms", "edges"],
};

const DEFAULTS = {
  roots: ["src"],
  extensions: [".tsx", ".jsx"],
  excludeDirs: ["node_modules"],
  excludeSuffixes: [".test.tsx", ".test.jsx", ".spec.tsx", ".spec.jsx", ".stories.tsx", ".stories.jsx", ".d.ts"],
  pageDirs: ["pages", "screens", "app"],
  sharedDirs: ["components", "ui"],
};
const RESOLVE_EXTS = [".tsx", ".ts", ".jsx", ".js", "/index.tsx", "/index.ts", "/index.jsx", "/index.js"];
const PLATFORMS = ["android", "ios", "native", "web"];
export const MAX_SOURCE_BYTES = 1024 * 1024;

const listOption = (options, key, label) => {
  const v = options[key];
  if (v === undefined) return DEFAULTS[key];
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) throw new Error(`components.${label ?? key} must be an array of strings`);
  return v;
};

// Bracket matching on the mask (string and comment bodies blanked).
function matchBracket(mask, open) {
  const pairs = { "(": ")", "[": "]", "{": "}" };
  const close = pairs[mask[open]];
  let depth = 0;
  for (let i = open; i < mask.length; i++) {
    const ch = mask[i];
    if (ch === mask[open]) depth++;
    else if (ch === close && --depth === 0) return i;
  }
  return -1;
}

// Does a body (mask text) contain JSX? A `<` followed by a tag name or a
// fragment `<>`, never `a < b` (a space or digit follows) and never a
// generic `<T>(` (the mask keeps those too; a tag name followed by `>` or a
// space then an attribute is the JSX shape).
const hasJsx = (maskBody) => /<(?:>|[A-Za-z][\w.:-]*(?:\s[^<>]*)?\/?>)/.test(maskBody);

// Props from `{ a: string; b?: number }` text (one brace level): members
// split at depth 0 on `;`, `,` or newline. Types are kept as written,
// collapsed to one line.
export function parseProps(bodyText) {
  const out = [];
  let depth = 0;
  let cur = "";
  const push = () => {
    const s = cur.trim();
    cur = "";
    if (!s) return;
    const m = /^(?:readonly\s+)?([A-Za-z_$][\w$]*|'[^']*'|"[^"]*")\s*(\?)?\s*:\s*([\s\S]+)$/.exec(s);
    if (!m) return;
    out.push({ name: m[1].replace(/^['"]|['"]$/g, ""), type: m[3].replace(/\s+/g, " ").trim(), optional: m[2] === "?" });
  };
  let prev = "";
  for (const ch of bodyText) {
    if ("([{<".includes(ch)) depth++;
    else if (")]}".includes(ch) || (ch === ">" && prev !== "=")) depth--;
    prev = ch;
    if (depth === 0 && (ch === ";" || ch === "," || ch === "\n")) {
      push();
      continue;
    }
    cur += ch;
  }
  push();
  return out;
}

// The props of a component from its parameter list text and the file: an
// inline object type on the first parameter, else a named type found in the
// same file as `type X = {...}` / `interface X {...}`, else the name and
// where it was imported from.
function propsOf(paramsText, file) {
  const m = /^\s*(?:\{[^}]*\}|[A-Za-z_$][\w$]*)\s*:\s*([\s\S]+?)\s*(?:,\s*[A-Za-z_$][\w$]*\s*:[\s\S]*)?$/.exec(paramsText);
  if (!m) return {};
  const ann = m[1].trim().replace(/^Readonly<([\s\S]*)>$/, "$1");
  if (ann.startsWith("{")) {
    const close = matchBracket(ann.split(""), 0);
    return { props: parseProps(ann.slice(1, close === -1 ? undefined : close)) };
  }
  const name = /^([A-Za-z_$][\w$]*)(?:<[^>]*>)?$/.exec(ann)?.[1];
  if (!name) return {};
  const esc = name.replace(/\$/g, "\\$");
  const decl = new RegExp(`\\b(?:type\\s+${esc}\\s*(?:<[^>]*>)?\\s*=\\s*|interface\\s+${esc}\\b[^{]*)\\{`).exec(file.mask);
  if (decl) {
    const open = decl.index + decl[0].length - 1;
    const close = matchBracket(file.mask, open);
    if (close !== -1) return { props: parseProps(file.text.slice(open + 1, close)), propsType: name };
  }
  const from = file.imports.get(name);
  return from ? { propsType: name, propsFrom: from } : { propsType: name };
}

// Where each imported NAME comes from, types included (`import type { P }`
// is erased at runtime but is exactly what a props type is).
export function importedNames(text) {
  const { code } = lex(text);
  const out = new Map();
  for (const m of code.matchAll(/\bimport\s+(?:type\s+)?(?:[A-Za-z_$][\w$]*\s*,\s*)?\{([^}]*)\}\s*from\s*(['"])([^'"]+)\2/g)) {
    for (const seg of m[1].split(",")) {
      const s = seg.trim().replace(/^type\s+/, "");
      if (!s) continue;
      const [name, , alias] = s.split(/\s+(as)\s+/);
      out.set(alias ?? name, m[3]);
    }
  }
  for (const m of code.matchAll(/\bimport\s+(?:type\s+)?([A-Za-z_$][\w$]*)\s*(?:,|from)\s*(?:\{[^}]*\}\s*from\s*)?(['"])([^'"]+)\2/g)) if (!out.has(m[1])) out.set(m[1], m[3]);
  return out;
}

// The props of a scanned component: from its parameter list, else from the
// wrapper's type argument (`forwardRef<HTMLDivElement, Props>`).
function propsOfComponent(c, file) {
  const fromParams = propsOf(c.params, file);
  if (Object.keys(fromParams).length || !c.propsFromGeneric) return fromParams;
  return propsOf(`props: ${c.propsFromGeneric}`, file);
}

// Every component declared in one file: { name, export, start, end, params,
// description }. Found on the mask; names and bodies read from the text.
export function scanComponents(text) {
  const { mask } = lex(text);
  const m = model(text);
  const file = { text, mask };
  const out = [];
  const seen = new Set();
  const add = (name, exportKind, at, paramsText, bodyMaskText, wrapper) => {
    if (!/^[A-Z]/.test(name) || seen.has(name) || !hasJsx(bodyMaskText)) return;
    seen.add(name);
    // The JSDoc attached to the component: the LAST `/** … */` before it,
    // with only whitespace between. A body that may not hold `*/` keeps the
    // match from starting at an earlier JSDoc (a type's, a constant's) and
    // running across the code between (CAS-99).
    const jsdoc = /\/\*\*((?:(?!\*\/)[\s\S])*)\*\/\s*$/.exec(text.slice(Math.max(0, at - 2000), at));
    const description = jsdoc ? jsdoc[1].split("\n").map((l) => l.replace(/^\s*\*\s?/, "").trim()).filter((l) => l && !l.startsWith("@")).join(" ") : m.commentAbove(at);
    // `forwardRef<Ref, Props>` / `memo<Props>`: the props type when the
    // parameter list itself carries no annotation.
    let propsFromGeneric;
    if (wrapper && wrapper.generic) {
      const args = splitTypeArgs(wrapper.generic);
      propsFromGeneric = wrapper.name === "forwardRef" ? args[1] : args[0];
    }
    out.push({ name, export: exportKind, at, params: paramsText, description, propsFromGeneric });
  };
  // `export function Name(params) { body }` / `export default function Name(`
  const fn = /\bexport\s+(default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\(/g;
  for (const hit of mask.matchAll(fn)) {
    const open = hit.index + hit[0].length - 1;
    const closeParams = matchBracket(mask, open);
    if (closeParams === -1) continue;
    let b = closeParams + 1;
    while (b < mask.length && mask[b] !== "{") {
      if (mask[b] === ";" || mask[b] === "\n" && /\S/.test(mask.slice(closeParams + 1, b))) break;
      b++;
    }
    if (mask[b] !== "{") continue;
    const closeBody = matchBracket(mask, b);
    if (closeBody === -1) continue;
    add(hit[2], hit[1] ? "default" : "named", hit.index, text.slice(open + 1, closeParams), mask.slice(b, closeBody + 1));
  }
  // `export const Name = (params) => body` / `= memo((params) => …)` /
  // `= forwardRef<…>((props, ref) => …)` / `= memo(function Name(…) {…})`
  const arrow = /\bexport\s+(?:default\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::\s*[^=]+)?=\s*(?:(?:React\.)?(memo|forwardRef)\s*(<(?:[^<>]|<[^<>]*>)*>)?\s*\(\s*)?(?:async\s*)?(?:function\s*(?:[A-Za-z_$][\w$]*)?\s*)?(?:<[^>]*>)?\s*\(/g;
  for (const hit of mask.matchAll(arrow)) {
    const open = hit.index + hit[0].length - 1;
    const closeParams = matchBracket(mask, open);
    if (closeParams === -1) continue;
    const wrapper = hit[2] ? { name: hit[2], generic: hit[3] ? text.slice(hit.index + hit[0].indexOf(hit[3]) + 1, hit.index + hit[0].indexOf(hit[3]) + hit[3].length - 1) : null } : null;
    // The body: to the end of the statement — the next line at depth 0 that
    // starts a new top-level statement, or the file's end.
    const stmt = m.text.length;
    let end = stmt;
    const after = mask.slice(closeParams + 1);
    const nextStmt = /\n(?=(?:export\b|import\b|function\b|const\b|let\b|var\b|class\b|type\b|interface\b|enum\b))/.exec(after);
    if (nextStmt) end = closeParams + 1 + nextStmt.index;
    add(hit[1], /\bexport\s+default\b/.test(hit[0]) ? "default" : "named", hit.index, text.slice(open + 1, closeParams), mask.slice(closeParams + 1, end), wrapper);
  }
  // `export default memo(Name)` / `export default Name` / `export { Name }`
  // for a component declared without export: look the declaration up.
  const reexport = /\bexport\s+default\s+(?:(?:React\.)?(?:memo|forwardRef)\s*\(\s*)?([A-Z][\w$]*)\s*\)?\s*;?/g;
  const named = /\bexport\s*\{([^}]*)\}\s*;?(?!\s*from)/g;
  const candidates = [];
  for (const hit of mask.matchAll(reexport)) candidates.push([hit[1], "default"]);
  for (const hit of mask.matchAll(named)) for (const seg of hit[1].split(",")) {
    const nm = seg.trim().split(/\s+as\s+/)[0];
    if (/^[A-Z][\w$]*$/.test(nm)) candidates.push([nm, "named"]);
  }
  for (const [name, exportKind] of candidates) {
    if (seen.has(name)) continue;
    const esc = name.replace(/\$/g, "\\$");
    const decl = new RegExp(`(?:^|\\n)\\s*(?:(?:async\\s+)?function\\s+${esc}\\s*(?:<[^>]*>)?\\s*\\(|(?:const|let|var)\\s+${esc}\\s*(?::\\s*[^=]+)?=\\s*(?:(?:React\\.)?(?:memo|forwardRef)\\s*(?:<(?:[^<>]|<[^<>]*>)*>)?\\s*\\(\\s*)?(?:async\\s*)?(?:function\\s*[\\w$]*\\s*)?(?:<[^>]*>)?\\s*\\()`).exec(mask);
    if (!decl) continue;
    const open = decl.index + decl[0].length - 1;
    const closeParams = matchBracket(mask, open);
    if (closeParams === -1) continue;
    const after = mask.slice(closeParams + 1);
    const nextStmt = /\n(?=(?:export\b|import\b|function\b|const\b|let\b|var\b|class\b|type\b|interface\b|enum\b))/.exec(after);
    const end = nextStmt ? closeParams + 1 + nextStmt.index : mask.length;
    add(name, exportKind, decl.index, text.slice(open + 1, closeParams), mask.slice(closeParams + 1, end));
  }
  out.sort((a, b) => a.at - b.at);
  return { components: out, file };
}

// `A, B<C, D>` -> ["A", "B<C, D>"]: top-level type arguments.
function splitTypeArgs(s) {
  const out = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if ("<([{".includes(ch)) depth++;
    else if (">)]}".includes(ch)) depth--;
    if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

// A platform-suffixed file name -> { base, platform }, else null.
const platformOf = (rel) => {
  const m = /^(.*)\.(android|ios|native|web)\.(tsx|jsx)$/.exec(rel);
  return m ? { base: `${m[1]}.${m[3]}`, platform: m[2] } : null;
};

export function derive({ repoRoot, options, io }) {
  const diagnostics = [];
  const roots = listOption(options, "roots").map((r) => repoRelative(r, "components.roots"));
  const extensions = listOption(options, "extensions");
  const excludeDirs = listOption(options, "excludeDirs");
  const excludeSuffixes = listOption(options, "excludeSuffixes");
  const pageDirs = listOption(options, "pageDirs");
  const sharedDirs = listOption(options, "sharedDirs");
  const srcAliasRoot = repoRelative(options.srcAliasRoot ?? roots[0] ?? "src", "components.srcAliasRoot");
  void repoRoot; // every read goes through io (decision 0010)

  // 1. Every candidate file under the roots, in one sorted order.
  const files = [];
  const seen = new Set();
  for (const root of roots) {
    const walked = io.walk(
      root,
      (rel, name) => {
        if (seen.has(rel)) return;
        if (!extensions.some((e) => name.endsWith(e)) || excludeSuffixes.some((s) => name.endsWith(s))) return;
        seen.add(rel);
        files.push(rel);
      },
      { enter: (rel, name) => name !== ".git" && !excludeDirs.includes(name) },
    );
    if (!walked.exists) diagnostics.push(`${root} not found — nothing to inventory`);
    if (walked.truncated) diagnostics.push(`${root}: walk truncated (depth or entry budget) — the inventory under it is incomplete`);
    for (const s of walked.skipped ?? []) diagnostics.push(`${s.path ?? s}: ${s.reason ?? "skipped"}`);
  }
  files.sort();
  const inDir = (rel, names) => rel.split("/").slice(0, -1).some((seg) => names.includes(seg));

  // 2. Read and scan each file once: its components, its local imports.
  const read = (rel) => {
    const r = io.read(rel, { maxBytes: MAX_SOURCE_BYTES });
    if (!r.ok) {
      if (r.code !== "missing") diagnostics.push(`${rel} ${r.reason}`);
      return null;
    }
    return r.text;
  };
  const exists = (rel) => io.read(rel, { maxBytes: 1 }).code !== "missing";
  const resolveImport = (fromRel, source) => {
    const base = source.startsWith("@/") ? posix.join(srcAliasRoot, source.slice(2)) : posix.normalize(posix.join(posix.dirname(fromRel), source));
    if (base.startsWith("../") || base === "..") return null;
    for (const ext of ["", ...RESOLVE_EXTS]) {
      const candidate = base + ext;
      const exact = ext === "" && /\.[^./]+$/.test(candidate.split("/").pop());
      if (ext === "" && !exact) continue;
      if (!/\.(tsx?|jsx?)$/.test(candidate)) {
        if (exact) return null;
        continue;
      }
      if (exists(candidate)) return candidate;
      if (exact) return null;
    }
    // A platform pair has no base file: `./Button` is Button.web.tsx and
    // Button.native.tsx to the bundler. The pair's record is keyed by the
    // base spelling, so that is what an import of it resolves to.
    for (const ext of [".tsx", ".jsx"]) {
      if (PLATFORMS.some((p) => exists(`${base}.${p}${ext}`))) return `${base}${ext}`;
    }
    return null;
  };

  const scanned = new Map(); // rel -> { text, components, imports: Map(localName -> resolved rel), names: Map(resolved rel -> Set(names)|null) }
  for (const rel of files) {
    const text = read(rel);
    if (text === null) continue;
    const { components, file } = scanComponents(text);
    const importMapOf = localImports(text);
    const names = new Map();
    for (const [source, { names: asked }] of importMapOf) {
      const target = resolveImport(rel, source);
      if (!target) continue;
      names.set(target, asked === null ? null : new Set([...(names.get(target) ?? []), ...asked]));
    }
    scanned.set(rel, { text, mask: file.mask, components, imports: importMapOf, resolved: names, isPage: inDir(rel, pageDirs) });
  }

  // 3. Records, one per exported component in a non-page file; a platform
  // pair (X.web.tsx / X.native.tsx) folds into one record.
  const records = [];
  const byKey = new Map(); // `${baseRel}#${name}` -> record
  const keyOf = (rel, name) => `${platformOf(rel)?.base ?? rel}#${name}`;
  for (const [rel, s] of scanned) {
    if (s.isPage || !s.components.length) continue;
    const plat = platformOf(rel);
    for (const c of s.components) {
      const key = keyOf(rel, c.name);
      let rec = byKey.get(key);
      if (!rec) {
        const idFile = plat ? plat.base : rel;
        rec = {
          kind: "component",
          id: `component:${idFile}#${c.name}`,
          title: c.name,
          description: c.description ?? "",
          resource: [],
          refs: [],
          facts: { name: c.name, export: c.export, ...propsOfComponent(c, { text: s.text, mask: s.mask, imports: importedNames(s.text) }) },
          filename: `${idFile.replace(/\.(tsx|jsx)$/, "").replace(/[^A-Za-z0-9._-]+/g, "--")}--${c.name}.json`,
          _files: [],
          _calls: new Set(),
          _reads: new Set(),
          _usedBy: new Set(),
          _uses: new Set(),
          _usedBySurfaces: new Set(),
        };
        byKey.set(key, rec);
        records.push(rec);
      }
      rec._files.push(rel);
      if (plat) (rec.facts.platforms ??= []).push(plat.platform);
      // Calls and reads from the whole file: a component's data module is
      // one hop away in the routing extractors; here the file is the unit.
      for (const p of scanApiCalls(s.text)) rec._calls.add(`?route:${p}`);
      const data = scanDataCalls(s.text, moduleConsts(s.text));
      for (const n of data.from) rec._reads.add(`?from:${n}`);
      for (const n of data.rpc) rec._reads.add(`?function:${n}`);
    }
  }

  // 4. Who imports whom: for every scanned file, each resolved local import
  // that lands on a component file credits the components it asks for (or
  // all of them, for a default / namespace import).
  const componentsInFile = new Map(); // rel (or a pair's base spelling) -> [rec]
  const fileRecs = (f) => componentsInFile.get(f) ?? componentsInFile.set(f, []).get(f);
  for (const rec of records) {
    for (const f of rec._files) {
      fileRecs(f).push(rec);
      const plat = platformOf(f);
      if (plat && !fileRecs(plat.base).includes(rec)) fileRecs(plat.base).push(rec);
    }
  }
  for (const [rel, s] of scanned) {
    for (const [target, asked] of s.resolved) {
      // A platform pair is imported by its base name: `./Button` resolves to
      // Button.tsx when present; a pair without a base resolves to nothing
      // here and is credited through either sibling below.
      const recs = componentsInFile.get(target) ?? [];
      for (const rec of recs) {
        if (asked !== null && !asked.has(rec.facts.name) && !(rec.facts.export === "default" && asked.has("default"))) continue;
        if (rec._files.includes(rel)) continue;
        rec._usedBy.add(rel);
        if (s.isPage) rec._usedBySurfaces.add(rel);
        else for (const importer of componentsInFile.get(rel) ?? []) importer._uses.add(rec.id);
      }
    }
  }

  // 5. Finish each record: shared rule, edges, sorted resources.
  for (const rec of records) {
    rec.resource = [...rec._files].sort();
    const usedBy = [...rec._usedBy].sort();
    const byDir = rec.resource.some((f) => inDir(f, sharedDirs));
    rec.facts.usedBy = usedBy;
    rec.facts.shared = byDir || usedBy.length >= 2;
    rec.facts.sharedBy = rec.facts.shared ? (byDir ? "dir" : "imports") : "none";
    if (rec.facts.platforms) rec.facts.platforms = [...new Set(rec.facts.platforms)].sort();
    const edges = {};
    const uses = [...rec._uses].sort();
    const calls = [...rec._calls].sort();
    const reads = [...rec._reads].sort();
    const surfaces = [...rec._usedBySurfaces].sort().map((f) => `?surface:${f}`);
    if (uses.length) edges.uses = uses;
    if (calls.length) edges.calls = calls;
    if (reads.length) edges.reads = reads;
    if (surfaces.length) edges.usedBy = surfaces;
    if (Object.keys(edges).length) rec.facts.edges = edges;
    rec.refs = [...new Set([...uses, ...calls, ...reads, ...surfaces])].sort();
    for (const k of Object.keys(rec)) if (k.startsWith("_")) delete rec[k];
  }
  records.sort((a, b) => (a.id < b.id ? -1 : 1));
  if (!files.length && roots.length) diagnostics.push(`no ${extensions.join("/")} files under ${roots.join(", ")} — nothing to inventory`);
  return { records, diagnostics };
}
