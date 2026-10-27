// react-router extractor — surfaces from a route tree DECLARED IN CODE: the
// `RouteObject[]` / `createBrowserRouter([...])` array form, or the JSX
// `<Route path element>` form under `<Routes>` / `createRoutesFromElements`.
// One convention: React Router's code-declared route tree (library mode, as
// Vite apps use it — the Next.js extractor reads a file layout and cannot see
// this). One surface record per LEAF route with a path (index routes take
// their parent's path); a route with children is a layout (its element
// renders an <Outlet>) and not a surface, pathless or not — its element name
// is carried on every descendant as `facts.guards`, so the record says which
// shells and gates a screen sits behind; a path-bearing layout's index child
// is the surface at that path.
// Options (extractorOptions["react-router"]):
//   routesFile    repo-relative file holding the route tree (default
//                 "src/routes.tsx"). Missing with no folder yet = "nothing
//                 to inventory" (greenfield); missing beside a real folder,
//                 a link, or over the size cap = derive fails (decision
//                 0013) — every surface record hangs on this one file
//   srcAliasRoot  where the tsconfig `@/` alias points (default: routesFile's
//                 directory)
//   (subscribeCalls moved to supabase-js in 0.9: set here, it is a warning)
// Purely textual — no TypeScript parser — but LEXICALLY honest (review
// CR-006): one pass masks every comment, string body, template body and
// regex literal to spaces, and every structural decision (bracket matching,
// route anchors, `<Route` tags, API-call sites, imports) is made on the
// masked text, reading literal values back from the original at the same
// offsets. So a commented-out route, a route inside a docstring, or a loader
// regex holding a `}` cannot forge, hide or truncate a record. The tree is
// the array handed to `create*Router(...)` — a literal or a local `const`
// binding — else the `routes` binding, else the first `RouteObject[]`
// binding; `children:` and `...spread` entries naming a local array binding
// are followed, anything else is a diagnostic (CR-018). `lazy: () =>
// import("./x")` and `const X = lazy(() => import("./x"))` resolve to their
// module (CR-017). The description is the `//` comment line(s) directly above
// the route entry — the code comment (store #3) doing double duty, as the
// Next.js extractor's leading comment does. The resource is the element's
// file (a relative or `@/` import); a framework element (`<Navigate>`) keeps
// the routes file. Outbound refs: API calls in the element file and in the
// local modules it imports ONE hop away (a screen's data module:
// `api.get("/users")`, `fetch("/v1/x")`, any receiver — textual on purpose)
// are emitted UNRESOLVED (`?route:/users`) for the deriver to resolve against
// whichever extractor owns the API. The code a screen runs is named the same
// way, `?code:<file>#<unit>` (decision 0037; adapters/js names the units):
// the element file whole (`#*`), and in each one-hop module the units the
// import reaches — how that code reaches the database is a data-access
// adapter's (supabase-js) to say, and the core folds it in. A
// named import narrows the module to what the imported names reach — their
// declarations, the helpers those mention, and top-level code; a default or
// namespace import, or a name the module does not declare itself, takes the
// module whole with a diagnostic (decision 0011, superseding 0009's "whole"
// in part). Every file read is a regular file physically
// inside the repo (no symlink on any segment) and under MAX_SOURCE_BYTES,
// else a diagnostic (CR-001). Deterministic: same bytes in, same records out.

import { posix } from "node:path";
import { slugify } from "../../core/lib/slug.mjs";
import { repoRelative } from "../../core/lib/paths.mjs";
import { MAX_SOURCE_BYTES, RESOLVE_EXTS, codeUnits, firstNonSpace, importMap, localImports, matchBracket, model, narrowModule, scanApiCalls, skipJsx, stringAt, topLevel } from "../js/source.mjs";

// Route-tree nesting the parser will follow; deeper is a diagnostic, never a
// stack overflow (CR-004). Real trees are three or four deep.
const MAX_TREE_DEPTH = 32;

export const FACTS_KEY_ORDER = {
  surface: ["element", "guards", "dynamicSegments", "edges"],
};

// ---------------------------------------------------------------------------
// Array-form route tree
// ---------------------------------------------------------------------------
// The `{...}` objects and `...spread` entries at depth 1 of the array literal
// whose `[` is at `open` (on the mask).
function arrayEntries(m, open) {
  const out = [];
  const end = matchBracket(m.mask, open);
  let i = open + 1;
  while (i < end) {
    const ch = m.mask[i];
    if (ch === "{") {
      const close = matchBracket(m.mask, i);
      out.push({ kind: "object", start: i + 1, end: close - 1, at: i });
      i = close;
    } else if (ch === "." && m.mask.startsWith("...", i)) {
      const id = /^\.\.\.\s*([A-Za-z_$][\w$]*)/.exec(m.mask.slice(i));
      out.push({ kind: "spread", name: id ? id[1] : null, at: i });
      i += id ? id[0].length : 3;
    } else if (ch === "(" || ch === "[") i = matchBracket(m.mask, i);
    else i++;
  }
  return out;
}

// `key: value` pairs at depth 0 of an object body [start, end) on the mask.
// Values are { raw (original text), start, end }.
function objectProps(m, start, end) {
  const props = new Map();
  let i = start;
  while (i < end) {
    const seg = m.mask.slice(i, end);
    const kv = /^[\s,]*([A-Za-z_$][\w$]*)\s*:/.exec(seg);
    if (kv) {
      const vs = i + kv[0].length;
      const ve = nextComma(m.mask, vs, end);
      props.set(kv[1], { raw: m.text.slice(vs, ve).trim(), start: vs, end: ve });
      i = ve + 1;
      continue;
    }
    const short = /^[\s,]*([A-Za-z_$][\w$]*)\s*(?=,|$)/.exec(seg);
    if (short) {
      props.set(short[1], { raw: "true", start: i, end: i + short[0].length });
      i += short[0].length;
      continue;
    }
    const j = nextComma(m.mask, i, end);
    if (j <= i) break;
    i = j + 1;
  }
  return props;
}
function nextComma(mask, i, end) {
  for (; i < end; i++) {
    const ch = mask[i];
    if (ch === ",") return i;
    if (ch === "(" || ch === "[" || ch === "{") i = matchBracket(mask, i) - 1;
    else if (ch === "<" && /[A-Za-z>]/.test(mask[i + 1] ?? "")) i = skipJsx(mask, i) - 1;
  }
  return end;
}

const literal = (m, v) => {
  const i = firstNonSpace(m.mask, v.start);
  return /['"`]/.test(m.mask[i]) && m.mask.indexOf(m.mask[i], i + 1) < v.end ? stringAt(m, i) : null;
};
// `<Name ...` / `Name` / `lazy(() => import("./x"))` (the last returns the
// import source with a leading `import:` so the caller can tell).
function elementName(m, v) {
  if (!v) return null;
  const s = m.mask.slice(v.start, v.end).trim();
  const jsx = /^<([A-Za-z_$][\w$.]*)/.exec(s);
  if (jsx) return jsx[1];
  const ident = /^([A-Za-z_$][\w$.]*)$/.exec(s);
  if (ident) return ident[1];
  return null;
}
function lazyImport(m, v) {
  if (!v) return null;
  const rel = /\bimport\s*\(\s*(['"])/.exec(m.mask.slice(v.start, v.end));
  return rel ? stringAt(m, v.start + rel.index + rel[0].length - 1) : null;
}

// A local array binding: `const <name>(: T)? = [` on the mask -> index of `[`.
function arrayBinding(m, name) {
  const re = new RegExp(`\\b(?:const|let|var)\\s+${name.replace(/\$/g, "\\$")}\\s*(?::[^=;]*)?=\\s*\\[`, "g");
  const hit = re.exec(m.mask);
  return hit ? hit.index + hit[0].length - 1 : -1;
}

export function joinRoutePath(parent, child) {
  if (child === null || child === undefined) return parent;
  const abs = child.startsWith("/") ? child : `${parent.replace(/\/$/, "")}/${child}`;
  const joined = abs.replace(/\/{2,}/g, "/");
  return joined.length > 1 ? joined.replace(/\/$/, "") : joined;
}

function walkArray(m, open, parentPath, guards, out, diagnostics, depth, seen) {
  if (depth > MAX_TREE_DEPTH) {
    diagnostics.push(`route tree nested deeper than ${MAX_TREE_DEPTH} — deeper routes skipped`);
    return;
  }
  if (seen.has(open)) return; // a binding that includes itself
  seen.add(open);
  for (const e of arrayEntries(m, open)) {
    if (e.kind === "spread") {
      const at = e.name ? arrayBinding(m, e.name) : -1;
      if (at === -1) diagnostics.push(`route array spreads ${e.name ? `'${e.name}'` : "an expression"} that is not a local array literal — those routes are not inventoried`);
      else walkArray(m, at, parentPath, guards, out, diagnostics, depth + 1, seen);
      continue;
    }
    const props = objectProps(m, e.start, e.end);
    const pathProp = props.get("path");
    const path = pathProp ? literal(m, pathProp) : null;
    if (pathProp && path === null) {
      diagnostics.push(`route path is not a string literal (${pathProp.raw.slice(0, 40)}) — skipped`);
      continue;
    }
    const isIndex = props.has("index") && /^true$/.test(props.get("index").raw);
    const element = elementName(m, props.get("element") ?? props.get("Component"));
    const lazy = lazyImport(m, props.get("lazy"));
    const children = props.get("children");
    const full = path !== null ? joinRoutePath(parentPath, path) : parentPath;
    if (children) {
      const i = firstNonSpace(m.mask, children.start);
      let at = -1;
      if (m.mask[i] === "[") at = i;
      else {
        const id = /^[A-Za-z_$][\w$]*/.exec(m.mask.slice(i, children.end));
        if (id) at = arrayBinding(m, id[0]);
      }
      if (at === -1) diagnostics.push(`route ${full}: children is not a local array literal (${children.raw.slice(0, 40)}) — its routes are not inventoried`);
      else walkArray(m, at, full, element ? [...guards, element] : guards, out, diagnostics, depth + 1, seen);
    } else if (path !== null || isIndex) {
      out.push({ path: full, element, lazy, guards: [...guards], comment: m.commentAbove(e.at) });
    }
  }
  seen.delete(open);
}

// ---------------------------------------------------------------------------
// JSX form: every `<Route` on the mask, nested by the tag structure. A paired
// tag with no nested `<Route` inside is a LEAF (CR-011).
// ---------------------------------------------------------------------------
function walkJsx(m, out) {
  const stack = [];
  const re = /<Route\b|<\/Route\s*>/g;
  let hit;
  while ((hit = re.exec(m.mask))) {
    if (hit[0].startsWith("</")) {
      stack.pop();
      continue;
    }
    const tagEnd = skipJsxOpenTag(m.mask, hit.index);
    const attrsMask = m.mask.slice(hit.index + 6, tagEnd);
    const attrsText = m.text.slice(hit.index + 6, tagEnd);
    const selfClosing = /\/>\s*$/.test(attrsMask);
    let path = null;
    const pm = /\bpath\s*=\s*(?:(["'])|\{\s*(["'`]))/.exec(attrsMask);
    if (pm) {
      const q = hit.index + 6 + pm.index + pm[0].length - 1;
      path = stringAt(m, q);
    }
    const isIndex = /(^|\s)index(\s|=|\/|$)/.test(attrsMask) && !/\bindex\s*=\s*\{\s*false\s*\}/.test(attrsMask);
    const el = /\b(?:element|Component)\s*=\s*\{\s*<?([A-Za-z_$][\w$.]*)/.exec(attrsText);
    const element = el ? el[1] : null;
    const parent = stack[stack.length - 1] ?? { path: "/", guards: [] };
    const full = path !== null ? joinRoutePath(parent.path, path) : parent.path;
    // Paired tag: a leaf unless a nested <Route opens before its close.
    let leaf = selfClosing;
    if (!selfClosing) {
      const bodyEnd = skipJsx(m.mask, hit.index);
      leaf = !/<Route\b/.test(m.mask.slice(tagEnd, bodyEnd));
      if (leaf) re.lastIndex = bodyEnd; // consume its `</Route>` so the stack stays balanced
    }
    if (leaf) {
      if (path !== null || isIndex) out.push({ path: full, element, lazy: null, guards: [...parent.guards], comment: m.commentAbove(hit.index) });
    } else stack.push({ path: full, guards: element ? [...parent.guards, element] : parent.guards });
    if (re.lastIndex < tagEnd) re.lastIndex = tagEnd;
  }
}
function skipJsxOpenTag(mask, i) {
  for (; i < mask.length; i++) {
    if (mask[i] === "{") i = matchBracket(mask, i) - 1;
    else if (mask[i] === ">") return i + 1;
  }
  return mask.length;
}

export function parseRouteTree(text, diagnostics = []) {
  const m = model(text);
  const out = [];
  // The tree is what the router factory is handed: a literal, or a local
  // binding by name; else the `routes` binding; else the first RouteObject[].
  let open = -1;
  const call = /\bcreate(?:Browser|Hash|Memory)Router\s*\(/.exec(m.mask);
  if (call) {
    const i = firstNonSpace(m.mask, call.index + call[0].length);
    if (m.mask[i] === "[") open = i;
    else {
      const id = /^[A-Za-z_$][\w$]*/.exec(m.mask.slice(i));
      if (id) open = arrayBinding(m, id[0]);
      if (open === -1) {
        // The router names its tree; another binding is not it (CR-018).
        diagnostics.push(`create*Router(...) is handed ${id ? `'${id[0]}', which is not a local array literal` : "an expression, not an array literal"} — nothing to inventory from it`);
        return out;
      }
    }
  }
  if (open === -1) open = arrayBinding(m, "routes");
  if (open === -1) {
    const typed = /:\s*RouteObject\[\]\s*=\s*\[/.exec(m.mask);
    if (typed) open = typed.index + typed[0].length - 1;
  }
  if (open !== -1) walkArray(m, open, "/", [], out, diagnostics, 0, new Set());
  else if (/<Route\b/.test(m.mask)) walkJsx(m, out);
  else diagnostics.push("no route tree found (createBrowserRouter([...]), a RouteObject[] binding, or <Route> elements) — nothing to inventory");
  return out;
}

// ---------------------------------------------------------------------------
// derive(ctx) — the extractor contract
// ---------------------------------------------------------------------------
export function derive({ options, io }) {
  // Every read and every probe goes through io (decision 0040). A gitignored
  // file is not source (2.3.0, pick 1): never read, never "exists".
  const isIgnored = io.isIgnored;
  const diagnostics = [];
  const { routesFile: routesOpt = "src/routes.tsx", srcAliasRoot: aliasOpt } = options;
  // Realtime subscriptions are data access (decision 0037): supabase-js reads
  // them now. A config that still sets the option here is told, never
  // silently emptied (the upgrade moves it).
  const warnings = [];
  if (options.subscribeCalls !== undefined) warnings.push(`'subscribeCalls' is read by the supabase-js adapter since 0.9 — move it to extractorOptions["supabase-js"].subscribeCalls (it is ignored here)`);
  const routesFile = repoRelative(routesOpt, "react-router.routesFile");
  const srcAliasRoot = repoRelative(aliasOpt ?? posix.dirname(routesFile), "react-router.srcAliasRoot");
  // A read is a regular file physically inside the repo (no symlink on any
  // segment), under the byte cap; anything else is null plus one diagnostic.
  const reported = new Set();
  const readSource = (rel) => {
    const got = io.read(rel, { maxBytes: MAX_SOURCE_BYTES });
    if (got.ok) return got.text;
    const why = got.code === "ignored" ? "is gitignored — not source" : got.code === "too-large" ? `is over ${MAX_SOURCE_BYTES / 1024} KiB` : got.code === "missing" || got.code === "not-regular" ? "is not a regular file inside the repo (a symlink, a directory, or missing)" : got.reason.slice(rel.length + 1).replace(/ — not read$/, "");
    if (!reported.has(rel)) diagnostics.push(`${rel} ${why} — not read`);
    reported.add(rel);
    return null;
  };
  const exists = (rel) => !isIgnored(rel) && io.kind(rel) === "file";
  const resolveImport = (fromRel, source) => {
    const base = source.startsWith("@/") ? posix.join(srcAliasRoot, source.slice(2)) : posix.normalize(posix.join(posix.dirname(fromRel), source));
    if (base.startsWith("../") || base === "..") return null;
    // Resolution as bundlers do it: a specifier that exists exactly as
    // spelled is FINAL — a module if it has a code extension, else not one
    // the extractor reads (`./styles.css`), and never probed further
    // (`data.tsx.ts` — CR-030); a spelling that does not exist is probed with
    // the code extensions, which is how `./Widget.client` reaches
    // `Widget.client.tsx` (CR-032). A linked candidate is named, never
    // followed (CR-001); linked as spelled it is final, linked as a probe it
    // is skipped so a linked `data.tsx` cannot shadow a real `data.js` (CR-029).
    for (const ext of ["", ...RESOLVE_EXTS]) {
      const candidate = base + ext;
      const at = io.kind(candidate);
      if (at === "missing") continue; // nothing at this spelling
      if (at === "directory") continue; // `./admin` -> admin/index.ts comes later in the list
      if (isIgnored(candidate)) continue; // nothing at this spelling in a clean clone (CR-408): never final, never a shadow
      // "As spelled" is final only when the spelling carries an extension: an
      // extensionless entry named `data` (a file or a link) is not what
      // `./data` means, and must not shadow `data.tsx` (CR-033).
      const exact = ext === "" && /\.[^./]+$/.test(candidate.split("/").pop());
      if (ext === "" && !exact) continue;
      if (!/\.(tsx?|jsx?)$/.test(candidate)) {
        if (exact) return null;
        continue;
      }
      if (at === "file") return candidate;
      if (!reported.has(candidate)) diagnostics.push(`${candidate} is not a regular file inside the repo (a symlink, or under one) — not read`);
      reported.add(candidate);
      if (exact) return null;
    }
    return null;
  };

  if (!exists(routesFile)) {
    // Nothing at the path, beside a folder that exists, is a renamed or
    // misspelt routes file — and "nothing to inventory" would let derive
    // write every surface record away, with every check then passing on the
    // smaller truth (the second adopter, 1.3.0). Fail. So does something at the path
    // that is not a regular file inside the repo (a link, a directory): it
    // is never read, and the loss would be the same. No folder yet is
    // greenfield — bootstrap configures the path ahead of the code.
    // The folder is judged segment by segment, never through a link: only
    // a genuinely absent real directory is greenfield (1.3.0 CR-016).
    const dir = posix.dirname(routesFile);
    const notRegular = () => {
      throw new Error(`react-router: routesFile '${routesFile}' is not a regular file inside the repo (a symlink, a directory, or under a link) — never read; fix extractorOptions.react-router.routesFile`);
    };
    let cur = "";
    for (const seg of dir === "." ? [] : dir.split("/")) {
      cur = cur ? `${cur}/${seg}` : seg;
      const at = io.kind(cur);
      if (at === "missing") {
        diagnostics.push(`${routesFile} not found — nothing to inventory`);
        return { records: [], diagnostics, warnings };
      }
      if (at !== "directory") notRegular();
    }
    if (io.kind(routesFile) !== "missing") notRegular();
    if (dir === ".") {
      diagnostics.push(`${routesFile} not found — nothing to inventory`); // the root always exists: greenfield-shaped (decision 0013)
      return { records: [], diagnostics, warnings };
    }
    throw new Error(`react-router: routesFile '${routesFile}' does not exist, but its folder '${dir}' does — a renamed or misspelt routes file would drop every surface record; fix extractorOptions.react-router.routesFile`);
  }
  if (isIgnored(routesFile)) throw new Error(`react-router: routesFile '${routesFile}' is gitignored — not source; every surface record hangs on it, so derive stops rather than write them away (un-ignore it, or point extractorOptions.react-router.routesFile at the real one)`);
  // A routes file that exists but cannot be read (over the cap) would derive
  // zero surfaces as if the tree were empty — the same loss (1.3.0 CR-015).
  const text = readSource(routesFile);
  if (text === null) throw new Error(`react-router: routesFile '${routesFile}' is over ${MAX_SOURCE_BYTES / 1024} KiB — never read; every surface record hangs on it, so derive stops rather than write them away`);
  const routes = parseRouteTree(text, diagnostics);
  const imports = importMap(text);

  // The refs one piece of source text calls out to: its API calls, and the
  // code it runs (`?code:`, decision 0037) — how that code reaches the
  // database is a data-access adapter's to say. `context` is the whole
  // module when the text is one statement of it.
  const apiRefs = (body, context = body) => new Set([...scanApiCalls(body, context)].map((p) => `?route:${p}`));
  // A one-hop module, memoised: its whole-file refs, its statement model and
  // each statement's refs, scanned ONCE — a narrowed import is then a union
  // of precomputed sets, never a rescan of the module (1.3.0 CR-022). A
  // statement's refs include the code unit it belongs to (adapters/js).
  const modules = new Map();
  const moduleOf = (rel) => {
    if (!modules.has(rel)) {
      const body = readSource(rel);
      if (body === null) modules.set(rel, null);
      else {
        const model = topLevel(body);
        const unitOf = codeUnits(model);
        const stmtRefs = model.statements.map((st, k) => {
          const refs = apiRefs(body.slice(st.start, st.end), body);
          if (unitOf[k] !== null) refs.add(`?code:${rel}#${unitOf[k]}`);
          return refs;
        });
        modules.set(rel, { whole: new Set([...apiRefs(body), `?code:${rel}#*`]), model, stmtRefs, narrowed: new Map() });
      }
    }
    return modules.get(rel);
  };
  // A screen's refs: its own file whole, and of each local module it imports
  // only what the imported names reach (1.3.0) — the module whole, with a
  // diagnostic, when the import cannot be narrowed. One hop: the imported
  // module's own imports are not followed. Memoised per element file.
  const elements = new Map();
  const refsOfElement = (rel) => {
    if (elements.has(rel)) return elements.get(rel);
    const body = readSource(rel);
    const refs = body === null ? new Set() : new Set([...apiRefs(body), `?code:${rel}#*`]);
    elements.set(rel, refs);
    if (body === null) return refs;
    for (const [source, { names, how }] of localImports(body)) {
      const target = resolveImport(rel, source);
      const mod = target && moduleOf(target);
      if (!mod) continue;
      let hit = mod.whole;
      if (names === null) diagnostics.push(`${rel} imports ${target} ${how} — its calls are attributed whole`);
      else {
        const key = [...names].sort().join(",");
        if (!mod.narrowed.has(key)) {
          const cut = narrowModule(mod.model, names);
          mod.narrowed.set(key, cut.whole ? cut : { refs: new Set([...cut.statements].flatMap((k) => [...mod.stmtRefs[k]])) });
        }
        const cut = mod.narrowed.get(key);
        if (cut.whole === "missing") diagnostics.push(`${rel} imports '${cut.name}' from ${target}, which declares no such name — its calls are attributed whole`);
        else if (cut.whole === "reexport") diagnostics.push(`${rel} imports '${cut.name}' from ${target}, which re-exports it from another module — not followed (one hop); its calls are attributed whole`);
        else hit = cut.refs;
      }
      for (const r of hit) refs.add(r);
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
    const source = r.lazy ?? (r.element ? imports.get(r.element.split(".")[0]) : undefined);
    const isLocal = source && (source.startsWith(".") || source.startsWith("@/"));
    const elementFile = isLocal ? resolveImport(routesFile, source) : null;
    if (isLocal && !elementFile) diagnostics.push(`${routesFile}: ${r.element ?? "lazy route"} imports '${source}', which resolves to no file — routes file kept as resource`);
    const resource = elementFile ? [elementFile, routesFile] : [routesFile];
    const refs = elementFile ? new Set(refsOfElement(elementFile)) : new Set();
    // Filename: React Router's `:id`, `*` and the optional `?` are not
    // filename characters; spelled the shared slug way (`_id`, `___splat`),
    // an optional marker as a trailing `~` so `task` and `task?` stay distinct.
    const slugPath = r.path
      .split("/")
      .map((s) => {
        const opt = s.endsWith("?") ? "~" : "";
        const bare = opt ? s.slice(0, -1) : s;
        return bare === "*" ? "[...splat]" : bare.startsWith(":") ? `[${bare.slice(1)}${opt}]` : bare + opt;
      })
      .join("/");
    records.push({
      kind: "surface",
      id,
      title: r.path,
      description: r.comment,
      resource,
      refs: [...refs].sort(),
      facts: {
        element: r.element ?? (r.lazy ? `lazy(${r.lazy})` : ""),
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
  return { records, diagnostics, warnings };
}

export { DETECTION, detect } from "./detect.mjs";

// The adapter contract this adapter was written for, and how to comment
// out a line of each kind of file it reads: what the standard suite needs
// (decision 0040). `{}`: nothing it reads takes a line comment.
export const CONTRACT = 1;
export const COMMENT = { ".ts": "//", ".tsx": "//", ".js": "//", ".jsx": "//", ".mjs": "//", ".cjs": "//" };
