// react-router extractor — surfaces from a route tree DECLARED IN CODE: the
// `RouteObject[]` / `createBrowserRouter([...])` array form, or the JSX
// `<Route path element>` form under `<Routes>` / `createRoutesFromElements`.
// One convention: React Router's code-declared route tree (library mode, as
// Vite apps use it — the Next.js extractor reads a file layout and cannot see
// this). One surface record per route WITH A PATH (index routes take their
// parent's path); a route WITH CHILDREN is a layout (its element renders an
// <Outlet>) and not a surface, pathless or not — its element name is carried
// on every descendant as `facts.guards`, so the record says which shells and
// gates a screen sits behind; a path-bearing layout's index child is the
// surface at that path.
// Options (extractorOptions["react-router"]):
//   routesFile    repo-relative file holding the route tree (default
//                 "src/routes.tsx"); missing = "nothing to inventory"
//   srcAliasRoot  where the tsconfig `@/` alias points (default: routesFile's
//                 directory)
// Purely textual — no TypeScript parser. A bracket-aware scan splits the
// array into route objects and reads `path`, `index`, `element` /
// `Component`, `children` at each object's own depth; strings, template
// literals and comments are skipped for bracket counting. The description is
// the `//` comment line(s) directly above the route entry — the code comment
// (store #3) doing double duty, as the Next.js extractor's leading comment
// does. The resource is the element's file (a relative or `@/` import in the
// routes file); a framework element (`<Navigate>`) keeps the routes file.
// Outbound refs: API calls in the element file and in the local modules it
// imports ONE hop away (a screen's data module: `api.get("/users")`,
// `fetch("/v1/x")`) are emitted UNRESOLVED (`?route:/users`) for the deriver
// to resolve against whichever extractor owns the API; `.from('x')` /
// `.rpc('x')` likewise (`?from:` / `?function:`). One hop is deliberate: the
// data module's calls are attributed whole to every screen that imports it —
// mechanically true, and honest about what a grep can know (a module shared
// by three admin screens gives all three the same routes). Deterministic:
// same bytes in, same records out.

import { readFileSync, existsSync } from "node:fs";
import { join, dirname, posix } from "node:path";
import { slugify } from "../../lib/slug.mjs";
import { repoRelative } from "../../lib/paths.mjs";
import { scanFileText } from "../nextjs/refs.mjs";

const posixify = (p) => p.split(/[\\/]/).join("/");
const RESOLVE_EXTS = [".tsx", ".ts", ".jsx", ".js", "/index.tsx", "/index.ts", "/index.jsx", "/index.js"];

export const FACTS_KEY_ORDER = {
  surface: ["element", "guards", "dynamicSegments"],
};

// ---------------------------------------------------------------------------
// Scanner: walk `text` from `i`, skipping strings / template literals /
// comments, tracking bracket depth. Returns the index just past the bracket
// that closes the one opened at `open` (or text.length).
// ---------------------------------------------------------------------------
function skipTo(text, i, closer) {
  let depth = 0;
  for (; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === "/" && next === "/") {
      i = text.indexOf("\n", i);
      if (i === -1) return text.length;
      continue;
    }
    if (ch === "/" && next === "*") {
      const end = text.indexOf("*/", i + 2);
      if (end === -1) return text.length;
      i = end + 1;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      i = skipString(text, i);
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") {
      depth--;
      if (depth === 0 && ch === closer) return i + 1;
      if (depth < 0) return i;
    }
  }
  return text.length;
}
// Index just past the comment opening at `i` (`//` to end of line, `/* */`).
function skipComment(text, i) {
  if (text[i + 1] === "/") {
    const nl = text.indexOf("\n", i);
    return nl === -1 ? text.length : nl;
  }
  const end = text.indexOf("*/", i + 2);
  return end === -1 ? text.length : end + 2;
}
// Index of the closing quote for the string opening at `i`.
function skipString(text, i) {
  const q = text[i];
  for (i++; i < text.length; i++) {
    if (text[i] === "\\") {
      i++;
      continue;
    }
    if (q === "`" && text[i] === "$" && text[i + 1] === "{") {
      i = skipTo(text, i + 1, "}") - 1;
      continue;
    }
    if (text[i] === q) return i;
  }
  return text.length;
}

// The `{...}` objects at depth 1 of the array literal whose `[` is at `open`.
// Each comes with the `//` comment lines directly above it.
function arrayObjects(text, open) {
  const out = [];
  const end = skipTo(text, open, "]");
  let i = open + 1;
  while (i < end) {
    const ch = text[i];
    if (ch === "{") {
      const close = skipTo(text, i, "}");
      out.push({ start: i, end: close, body: text.slice(i + 1, close - 1), comment: commentAbove(text, i) });
      i = close;
    } else if (ch === "/" && (text[i + 1] === "/" || text[i + 1] === "*")) {
      i = skipComment(text, i);
    } else if (ch === '"' || ch === "'" || ch === "`") i = skipString(text, i) + 1;
    else if (ch === "(" || ch === "[") i = skipTo(text, i, ch === "(" ? ")" : "]");
    else i++;
  }
  return out;
}

// Contiguous `//` lines immediately above the line holding `at`, joined.
function commentAbove(text, at) {
  const lines = text.slice(0, text.lastIndexOf("\n", at - 1) + 1).split("\n");
  lines.pop(); // the (empty) tail after the final newline
  const found = [];
  for (let k = lines.length - 1; k >= 0; k--) {
    const t = lines[k].trim();
    if (!t.startsWith("//")) break;
    found.unshift(t.replace(/^\/\/\s?/, "").trim());
  }
  return found.filter(Boolean).join(" ");
}

// Top-level `key: value` pairs of one object body. Values are raw text; a
// nested structure is returned with its span so `children` can be re-parsed.
function objectProps(body) {
  const props = new Map();
  let i = 0;
  while (i < body.length) {
    const m = /^[\s,]*([A-Za-z_$][\w$]*)\s*:/.exec(body.slice(i));
    if (!m) {
      // Shorthand (`index,`), a spread, or a method — skip to the next comma
      // at this depth.
      const rest = /^[\s,]*([A-Za-z_$][\w$]*)\s*(?=,|$)/.exec(body.slice(i));
      if (rest) {
        props.set(rest[1], { raw: "true", start: i, end: i + rest[0].length });
        i += rest[0].length;
        continue;
      }
      const j = nextComma(body, i);
      if (j <= i) break;
      i = j;
      continue;
    }
    const key = m[1];
    const valueStart = i + m[0].length;
    const valueEnd = nextComma(body, valueStart);
    props.set(key, { raw: body.slice(valueStart, valueEnd).trim(), start: valueStart, end: valueEnd });
    i = valueEnd + 1;
  }
  return props;
}
// Index of the next `,` at depth 0 from `i` (or body.length).
function nextComma(body, i) {
  for (; i < body.length; i++) {
    const ch = body[i];
    if (ch === ",") return i;
    if (ch === "/" && (body[i + 1] === "/" || body[i + 1] === "*")) {
      i = skipComment(body, i) - 1;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      i = skipString(body, i);
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") {
      i = skipTo(body, i, ch === "(" ? ")" : ch === "[" ? "]" : "}") - 1;
      continue;
    }
    if (ch === "<") {
      // A JSX element value: skip to its end (self-closing or matching close).
      i = skipJsx(body, i) - 1;
      continue;
    }
  }
  return body.length;
}
// From a `<` that opens a JSX element, return the index just past the element.
function skipJsx(text, i) {
  let depth = 0;
  for (; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"' || ch === "'") {
      i = skipString(text, i);
      continue;
    }
    if (ch === "{") {
      i = skipTo(text, i, "}") - 1;
      continue;
    }
    if (ch === "<") {
      if (text[i + 1] === "/") {
        depth--;
        i = text.indexOf(">", i);
        if (i === -1) return text.length;
        if (depth <= 0) return i + 1;
      } else depth++;
      continue;
    }
    if (ch === "/" && text[i + 1] === ">") {
      depth--;
      if (depth <= 0) return i + 2;
      i++;
    }
  }
  return text.length;
}

const stringValue = (raw) => {
  const m = /^(['"`])((?:\\.|(?!\1).)*)\1$/.exec(raw);
  return m ? m[2] : null;
};
// `<Name ... />` / `<Name>` / `Name` (Component: Name) / `lazy(() => import("./x"))`.
function elementName(raw) {
  if (!raw) return null;
  const jsx = /^<([A-Za-z_$][\w$.]*)/.exec(raw);
  if (jsx) return jsx[1];
  const ident = /^([A-Za-z_$][\w$.]*)$/.exec(raw);
  return ident ? ident[1] : null;
}

// ---------------------------------------------------------------------------
// Route tree -> flat list of { path, element, guards, comment }
// ---------------------------------------------------------------------------
export function joinRoutePath(parent, child) {
  if (child === null || child === undefined) return parent;
  const abs = child.startsWith("/") ? child : `${parent.replace(/\/$/, "")}/${child}`;
  const joined = abs.replace(/\/{2,}/g, "/");
  return joined.length > 1 ? joined.replace(/\/$/, "") : joined;
}

function flattenObjects(text, open, parentPath, guards, out, diagnostics) {
  for (const obj of arrayObjects(text, open)) {
    const props = objectProps(obj.body);
    const pathRaw = props.get("path")?.raw;
    const path = pathRaw === undefined ? null : stringValue(pathRaw);
    if (pathRaw !== undefined && path === null) {
      diagnostics.push(`route path is not a string literal (${pathRaw.slice(0, 40)}) — skipped`);
      continue;
    }
    const isIndex = props.has("index") && /^true$/.test(props.get("index").raw);
    const element = elementName(props.get("element")?.raw ?? props.get("Component")?.raw ?? null);
    const children = props.get("children");
    const full = path !== null ? joinRoutePath(parentPath, path) : parentPath;
    // A route with children is a LAYOUT (its element renders an <Outlet>),
    // whether or not it has a path: not a surface, but a guard on every
    // descendant. Its index child is the surface at that path.
    if (children) {
      const arr = obj.body.indexOf("[", children.start);
      if (arr !== -1 && arr < children.end) flattenObjects(obj.body, arr, full, element ? [...guards, element] : guards, out, diagnostics);
    } else if (path !== null || isIndex) {
      out.push({ path: full, element, guards: [...guards], comment: obj.comment });
    }
  }
}

// JSX form: every `<Route` tag, nested by the tag structure.
function flattenJsx(text, out) {
  const stack = []; // { path, guards }
  const re = /<Route\b|<\/Route\s*>/g;
  let m;
  while ((m = re.exec(text))) {
    if (m[0].startsWith("</")) {
      stack.pop();
      continue;
    }
    const tagEnd = skipJsxOpenTag(text, m.index);
    const attrs = text.slice(m.index + 6, tagEnd);
    const selfClosing = /\/>\s*$/.test(attrs);
    const pathM = /\bpath\s*=\s*(?:"([^"]*)"|'([^']*)'|\{\s*(['"`])((?:\\.|(?!\3).)*)\3\s*\})/.exec(attrs);
    const path = pathM ? (pathM[1] ?? pathM[2] ?? pathM[4]) : null;
    const isIndex = /(^|\s)index(\s|=|\/|$)/.test(attrs) && !/\bindex\s*=\s*\{\s*false\s*\}/.test(attrs);
    const elM = /\b(?:element|Component)\s*=\s*\{\s*<?([A-Za-z_$][\w$.]*)/.exec(attrs);
    const element = elM ? elM[1] : null;
    const parent = stack[stack.length - 1] ?? { path: "/", guards: [] };
    const full = path !== null ? joinRoutePath(parent.path, path) : parent.path;
    // Self-closing = a leaf (a surface when it has a path or is the index);
    // an open tag = a layout, a guard on everything nested inside it.
    if (selfClosing) {
      if (path !== null || isIndex) out.push({ path: full, element, guards: [...parent.guards], comment: commentAbove(text, m.index) });
    } else stack.push({ path: full, guards: element ? [...parent.guards, element] : parent.guards });
    re.lastIndex = tagEnd;
  }
}
function skipJsxOpenTag(text, i) {
  for (; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"' || ch === "'") i = skipString(text, i);
    else if (ch === "{") i = skipTo(text, i, "}") - 1;
    else if (ch === ">") return i + 1;
  }
  return text.length;
}

export function parseRouteTree(text, diagnostics = []) {
  const out = [];
  // Array form: the first array literal after `createBrowserRouter(` /
  // `createHashRouter(` / `createMemoryRouter(`, else after a `RouteObject[]`
  // annotation or a `routes =` binding.
  const anchor =
    /\bcreate(?:Browser|Hash|Memory)Router\s*\(\s*\[/.exec(text) ??
    /:\s*RouteObject\[\]\s*=\s*\[/.exec(text) ??
    /\broutes\s*=\s*\[/.exec(text);
  if (anchor) {
    flattenObjects(text, anchor.index + anchor[0].length - 1, "/", [], out, diagnostics);
  } else if (/<Route\b/.test(text)) {
    flattenJsx(text, out);
  } else {
    diagnostics.push("no route tree found (createBrowserRouter([...]), a RouteObject[] binding, or <Route> elements) — nothing to inventory");
  }
  return out;
}

// ---------------------------------------------------------------------------
// Imports and API-call refs
// ---------------------------------------------------------------------------
// local name -> import source, for default, named and aliased imports.
export function importMap(text) {
  const imports = new Map();
  for (const m of text.matchAll(/import\s+(?:type\s+)?([A-Za-z_$][\w$]*)\s*(?:,\s*\{[^}]*\})?\s*from\s*(['"])([^'"]+)\2/g)) imports.set(m[1], m[3]);
  for (const m of text.matchAll(/import\s+(?:type\s+)?(?:[A-Za-z_$][\w$]*\s*,\s*)?\{([^}]*)\}\s*from\s*(['"])([^'"]+)\2/g)) {
    for (const part of m[1].split(",")) {
      const seg = part.trim().replace(/^type\s+/, "");
      if (!seg) continue;
      const aliased = /^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/.exec(seg);
      imports.set(aliased ? aliased[2] : seg, m[3]);
    }
  }
  return imports;
}
// Every local import source of a file (relative or `@/`), in order, deduped.
function localImportSources(text) {
  const out = [];
  for (const m of text.matchAll(/\bfrom\s*(['"])([^'"]+)\1/g)) {
    if ((m[2].startsWith(".") || m[2].startsWith("@/")) && !out.includes(m[2])) out.push(m[2]);
  }
  return out;
}
// Resolve an import source from `fromRel` to a repo-relative file, or null.
function resolveImport(repoRoot, fromRel, source, srcAliasRoot) {
  const base = source.startsWith("@/") ? posix.join(srcAliasRoot, source.slice(2)) : posix.normalize(posix.join(posix.dirname(fromRel), source));
  if (base.startsWith("../") || base === "..") return null;
  for (const ext of ["", ...RESOLVE_EXTS]) {
    const candidate = base + ext;
    if (/\.(tsx?|jsx?)$/.test(candidate) && existsSync(join(repoRoot, candidate))) return candidate;
  }
  return null;
}

// `${expr}` -> *, a leading `${base}` prefix dropped, query string and
// trailing slash removed — so `${baseUrl}/users?limit=${n}` reads `/users`.
export function normalizeApiPath(raw) {
  let url = raw.replace(/^\$\{[^}]*\}/, "").split("?")[0].replace(/\$\{[^}]*\}/g, "*");
  if (url.length > 1 && url.endsWith("/")) url = url.slice(0, -1);
  return url;
}
// API paths called from one file: `x.get("/users")` (get/post/put/patch/
// delete/request on any receiver) and `fetch("/v1/x")`, string or template
// literal, path starting with `/` once a leading `${base}` is dropped.
export function scanApiCalls(text) {
  const out = new Set();
  const re = /\b(?:fetch|\.(?:get|post|put|patch|delete|request))\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g;
  for (const m of text.matchAll(re)) {
    const path = normalizeApiPath(m[2]);
    if (path.startsWith("/") && path !== "/") out.add(path);
  }
  return out;
}

// ---------------------------------------------------------------------------
// derive(ctx) — the extractor contract
// ---------------------------------------------------------------------------
export function derive({ repoRoot, options }) {
  const diagnostics = [];
  const { routesFile: routesOpt = "src/routes.tsx", srcAliasRoot: aliasOpt } = options;
  const routesFile = repoRelative(routesOpt, "react-router.routesFile");
  const srcAliasRoot = repoRelative(aliasOpt ?? posix.dirname(routesFile), "react-router.srcAliasRoot");
  const abs = join(repoRoot, routesFile);
  if (!existsSync(abs)) {
    diagnostics.push(`${routesFile} not found — nothing to inventory`);
    return { records: [], diagnostics };
  }
  const text = readFileSync(abs, "utf8");
  const routes = parseRouteTree(text, diagnostics);
  const imports = importMap(text);

  // Refs of one file plus its one-hop local imports, memoised per file.
  const scanned = new Map();
  const refsOfFile = (rel) => {
    if (scanned.has(rel)) return scanned.get(rel);
    const refs = new Set();
    scanned.set(rel, refs);
    let body;
    try {
      body = readFileSync(join(repoRoot, rel), "utf8");
    } catch {
      return refs;
    }
    for (const p of scanApiCalls(body)) refs.add(`?route:${p}`);
    const scan = scanFileText(body);
    for (const name of scan.fromNames) refs.add(`?from:${name}`);
    for (const name of scan.rpcNames) refs.add(`?function:${name}`);
    return refs;
  };
  const refsOfElement = (rel) => {
    const refs = new Set(refsOfFile(rel));
    let body = "";
    try {
      body = readFileSync(join(repoRoot, rel), "utf8");
    } catch {
      return refs;
    }
    for (const source of localImportSources(body)) {
      const target = resolveImport(repoRoot, rel, source, srcAliasRoot);
      if (target) for (const r of refsOfFile(target)) refs.add(r);
    }
    return refs;
  };

  const records = [];
  const seen = new Set();
  for (const r of routes) {
    const id = `surface:${r.path}`;
    if (seen.has(id)) {
      diagnostics.push(`${routesFile}: route ${r.path} declared twice — second entry skipped`);
      continue;
    }
    seen.add(id);
    const source = r.element ? imports.get(r.element.split(".")[0]) : undefined;
    const elementFile = source && (source.startsWith(".") || source.startsWith("@/")) ? resolveImport(repoRoot, routesFile, source, srcAliasRoot) : null;
    if (source && !elementFile && (source.startsWith(".") || source.startsWith("@/"))) {
      diagnostics.push(`${routesFile}: element ${r.element} imports '${source}', which resolves to no file — routes file kept as resource`);
    }
    const resource = elementFile ? [elementFile, routesFile] : [routesFile];
    const refs = elementFile ? refsOfElement(elementFile) : new Set();
    // Filename: React Router's `:id` and `*` are not filename characters;
    // spelled the bracket way for the shared slug scheme (`_id`, `___splat`).
    const slugPath = r.path
      .split("/")
      .map((s) => (s === "*" ? "[...splat]" : s.startsWith(":") ? `[${s.slice(1).replace(/\?$/, "")}]` : s))
      .join("/");
    records.push({
      kind: "surface",
      id,
      title: r.path,
      description: r.comment,
      resource,
      refs: [...refs],
      facts: {
        element: r.element ?? "",
        guards: r.guards,
        dynamicSegments: r.path
          .split("/")
          .filter((s) => s.startsWith(":"))
          .map((s) => s.slice(1).replace(/\?$/, "")),
      },
      filename: `${slugify(slugPath)}.json`,
    });
  }
  records.sort((a, b) => (a.id < b.id ? -1 : 1));
  return { records, diagnostics };
}
