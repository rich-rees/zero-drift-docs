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
//                 "src/routes.tsx"); missing = "nothing to inventory"
//   srcAliasRoot  where the tsconfig `@/` alias points (default: routesFile's
//                 directory)
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
// whichever extractor owns the API; `.from('x')` / `.rpc('x')` likewise. One
// hop is deliberate: the data module's calls are attributed whole to every
// screen that imports it — mechanically true, and honest about what a grep
// can know (decision 0009). Every file read is a regular file physically
// inside the repo (no symlink on any segment) and under MAX_SOURCE_BYTES,
// else a diagnostic (CR-001). Deterministic: same bytes in, same records out.

import { readFileSync, lstatSync, realpathSync } from "node:fs";
import { join, posix } from "node:path";
import { slugify } from "../../lib/slug.mjs";
import { repoRelative } from "../../lib/paths.mjs";
import { regularFileInside } from "../../lib/walk-markdown.mjs";
import { scanFileText } from "../nextjs/refs.mjs";

const RESOLVE_EXTS = [".tsx", ".ts", ".jsx", ".js", "/index.tsx", "/index.ts", "/index.jsx", "/index.js"];
export const MAX_SOURCE_BYTES = 1024 * 1024;
// Route-tree nesting the parser will follow; deeper is a diagnostic, never a
// stack overflow (CR-004). Real trees are three or four deep.
const MAX_TREE_DEPTH = 32;

export const FACTS_KEY_ORDER = {
  surface: ["element", "guards", "dynamicSegments"],
};

// ---------------------------------------------------------------------------
// Lexical mask. `lex(text)` returns { code, mask }: `code` has comments and
// regex literals blanked to spaces (strings kept, for import / call-name
// scans); `mask` additionally blanks string and template BODIES (delimiters
// kept), so bracket matching sees only structure. Same length as `text`,
// same offsets. Iterative, one pass, no recursion.
// ---------------------------------------------------------------------------
export function lex(text) {
  const code = text.split("");
  const mask = text.split("");
  const n = text.length;
  const blank = (arr, from, to) => {
    for (let k = from; k < to; k++) if (arr[k] !== "\n") arr[k] = " ";
  };
  // A `/` starts a regex literal when the previous significant token cannot
  // end an expression (an operator, an opener, a keyword) — else it divides.
  const regexAllowed = (i) => {
    let k = i - 1;
    while (k >= 0 && /\s/.test(mask[k])) k--;
    if (k < 0) return true;
    const ch = mask[k];
    if (/[(,=:[!&|?{};<>+\-*%^~]/.test(ch)) return true;
    if (ch === ")") {
      // `if (x) /re/.test(y)`: the `)` closes a statement head, so what
      // follows is an expression start (review CR-006, round 2). Find the
      // matching `(` on the mask and the word before it.
      let depth = 0;
      let j = k;
      for (; j >= 0; j--) {
        if (mask[j] === ")") depth++;
        else if (mask[j] === "(" && --depth === 0) break;
      }
      let w = j - 1;
      while (w >= 0 && /\s/.test(mask[w])) w--;
      let ws = w;
      while (ws >= 0 && /[A-Za-z_$\d]/.test(mask[ws])) ws--;
      return ["if", "while", "for", "with"].includes(text.slice(ws + 1, w + 1));
    }
    if (/[A-Za-z_$\d\]]/.test(ch)) {
      let s = k;
      while (s >= 0 && /[A-Za-z_$\d]/.test(mask[s])) s--;
      const word = text.slice(s + 1, k + 1);
      return ["return", "typeof", "case", "do", "else", "in", "of", "instanceof", "void", "delete", "throw", "yield", "await"].includes(word);
    }
    return false;
  };
  let i = 0;
  // Template literals nest via `${ ... }`: a stack of "how many braces are
  // open inside the current interpolation".
  const tpl = [];
  while (i < n) {
    const ch = text[i];
    const next = text[i + 1];
    if (tpl.length && ch === "}" && tpl[tpl.length - 1] === 0) {
      // back into the template body
      tpl.pop();
      const start = i + 1;
      let k = start;
      for (; k < n; k++) {
        if (text[k] === "\\") {
          k++;
          continue;
        }
        if (text[k] === "`") break;
        if (text[k] === "$" && text[k + 1] === "{") break;
      }
      blank(mask, start, k);
      if (k < n && text[k] === "$") {
        tpl.push(0);
        i = k + 2;
      } else i = k + 1;
      continue;
    }
    if (tpl.length && ch === "{") {
      tpl[tpl.length - 1]++;
      i++;
      continue;
    }
    if (tpl.length && ch === "}") {
      tpl[tpl.length - 1]--;
      i++;
      continue;
    }
    if (ch === "/" && next === "/") {
      let k = text.indexOf("\n", i);
      if (k === -1) k = n;
      blank(code, i, k);
      blank(mask, i, k);
      i = k;
      continue;
    }
    if (ch === "/" && next === "*") {
      let k = text.indexOf("*/", i + 2);
      k = k === -1 ? n : k + 2;
      blank(code, i, k);
      blank(mask, i, k);
      i = k;
      continue;
    }
    if (ch === '"' || ch === "'") {
      let k = i + 1;
      for (; k < n && text[k] !== ch && text[k] !== "\n"; k++) if (text[k] === "\\") k++;
      blank(mask, i + 1, Math.min(k, n));
      i = Math.min(k + 1, n);
      continue;
    }
    if (ch === "`") {
      let k = i + 1;
      for (; k < n; k++) {
        if (text[k] === "\\") {
          k++;
          continue;
        }
        if (text[k] === "`") break;
        if (text[k] === "$" && text[k + 1] === "{") break;
      }
      blank(mask, i + 1, Math.min(k, n));
      if (k < n && text[k] === "$") {
        tpl.push(0);
        i = k + 2;
      } else i = Math.min(k + 1, n);
      continue;
    }
    if (ch === "/" && regexAllowed(i)) {
      let k = i + 1;
      let cls = false;
      for (; k < n && text[k] !== "\n"; k++) {
        const c = text[k];
        if (c === "\\") {
          k++;
          continue;
        }
        if (c === "[") cls = true;
        else if (c === "]") cls = false;
        else if (c === "/" && !cls) break;
      }
      if (k < n && text[k] === "/") {
        // flags
        let e = k + 1;
        while (e < n && /[a-z]/.test(text[e])) e++;
        blank(code, i, e);
        blank(mask, i, e);
        i = e;
        continue;
      }
    }
    i++;
  }
  return { code: code.join(""), mask: mask.join("") };
}

// Index just past the bracket closing the one opened at `open`, on the mask.
function matchBracket(mask, open) {
  const pairs = { "(": ")", "[": "]", "{": "}" };
  const closer = pairs[mask[open]];
  let depth = 0;
  for (let i = open; i < mask.length; i++) {
    const ch = mask[i];
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") {
      depth--;
      if (depth === 0) return ch === closer ? i + 1 : i;
      if (depth < 0) return i;
    }
  }
  return mask.length;
}

// From a `<` opening a JSX element on the mask, the index just past the element
// (self-closing, or its matching close tag).
function skipJsx(mask, i) {
  let depth = 0;
  for (; i < mask.length; i++) {
    const ch = mask[i];
    if (ch === "{") {
      i = matchBracket(mask, i) - 1;
      continue;
    }
    if (ch === "<") {
      if (mask[i + 1] === "/") {
        depth--;
        i = mask.indexOf(">", i);
        if (i === -1) return mask.length;
        if (depth <= 0) return i + 1;
      } else depth++;
      continue;
    }
    if (ch === "/" && mask[i + 1] === ">") {
      depth--;
      if (depth <= 0) return i + 2;
      i++;
    }
  }
  return mask.length;
}

// ---------------------------------------------------------------------------
// Source model: one file's text, its masks, its line table and the `//`
// comment block above any offset (one pass — CR-005).
// ---------------------------------------------------------------------------
function model(text) {
  const { code, mask } = lex(text);
  const lineStart = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") lineStart.push(i + 1);
  // Per line: the comment text if the line is a bare `//` line, else null.
  const commentLine = lineStart.map((s, k) => {
    const e = k + 1 < lineStart.length ? lineStart[k + 1] - 1 : text.length;
    const t = text.slice(s, e).trim();
    return t.startsWith("//") ? t.replace(/^\/\/\s?/, "").trim() : null;
  });
  const lineOf = (at) => {
    let lo = 0;
    let hi = lineStart.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStart[mid] <= at) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  const commentAbove = (at) => {
    const found = [];
    for (let k = lineOf(at) - 1; k >= 0 && commentLine[k] !== null; k--) found.push(commentLine[k]);
    return found.reverse().filter(Boolean).join(" ");
  };
  return { text, code, mask, commentAbove };
}

const stringAt = (m, i) => {
  // `i` is a quote on the mask; the body is the original text up to the next
  // matching delimiter on the mask.
  const q = m.mask[i];
  const end = m.mask.indexOf(q, i + 1);
  return end === -1 ? null : m.text.slice(i + 1, end);
};
const firstNonSpace = (mask, i) => {
  while (i < mask.length && /\s/.test(mask[i])) i++;
  return i;
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
// Imports and API-call refs (on the comment-free `code` text)
// ---------------------------------------------------------------------------
// local name -> import source: default, named and aliased imports, and
// `const X = lazy(() => import("./x"))` (CR-017). `import type` is not a
// runtime dependency and binds nothing here (CR-019).
export function importMap(text) {
  const { code } = lex(text);
  const imports = new Map();
  for (const m of code.matchAll(/\bimport\s+(?!type\b)([A-Za-z_$][\w$]*)\s*(?:,\s*\{[^}]*\})?\s*from\s*(['"])([^'"]+)\2/g)) imports.set(m[1], m[3]);
  for (const m of code.matchAll(/\bimport\s+(?!type\b)(?:[A-Za-z_$][\w$]*\s*,\s*)?\{([^}]*)\}\s*from\s*(['"])([^'"]+)\2/g)) {
    for (const part of m[1].split(",")) {
      const seg = part.trim();
      if (!seg || /^type\s/.test(seg)) continue;
      const aliased = /^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/.exec(seg);
      imports.set(aliased ? aliased[2] : seg, m[3]);
    }
  }
  for (const m of code.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:React\.)?lazy\(\s*(?:async\s*)?\(\)\s*=>\s*import\(\s*(['"])([^'"]+)\2/g)) imports.set(m[1], m[3]);
  return imports;
}
// Every local runtime import source of a file (relative or `@/`), deduped.
function localImportSources(code) {
  const out = [];
  for (const m of code.matchAll(/\bimport\s+(type\s+)?[^;]*?\bfrom\s*(['"])([^'"]+)\2|\bimport\(\s*(['"])([^'"]+)\4/g)) {
    if (m[1]) continue;
    const src = m[3] ?? m[5];
    if ((src.startsWith(".") || src.startsWith("@/")) && !out.includes(src)) out.push(src);
  }
  return out;
}

// `${expr}` -> *, a leading `${base}` prefix dropped, query string and
// trailing slash removed — so `${baseUrl}/users?limit=${n}` reads `/users`.
export function normalizeApiPath(raw) {
  let url = raw.replace(/^\$\{[^}]*\}/, "").split("?")[0].replace(/\$\{[^}]*\}/g, "*");
  if (url.length > 1 && url.endsWith("/")) url = url.slice(0, -1);
  return url;
}
// API paths called from one file: `x.get("/users")` (get/post/put/patch/
// delete/request on any receiver, an optional TypeScript generic — nested
// one level — between the method and the call) and `fetch("/v1/x")`, string
// or template literal, path starting with `/` once a leading `${base}` is
// dropped. Call sites are found on the mask (never in a comment or a
// string); the path is read from the original text.
export function scanApiCalls(text) {
  const m = model(text);
  const out = new Set();
  const re = /\b(?:fetch|\.(?:get|post|put|patch|delete|request)(?:<(?:[^<>()]|<[^<>()]*>)*>)?)\(\s*(['"`])/g;
  for (const hit of m.mask.matchAll(re)) {
    const q = hit.index + hit[0].length - 1;
    const raw = stringAt(m, q);
    if (raw === null) continue;
    const path = normalizeApiPath(raw);
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
  let realRoot;
  try {
    realRoot = realpathSync(repoRoot);
  } catch {
    diagnostics.push("repo root unreadable — nothing to inventory");
    return { records: [], diagnostics };
  }

  // A read is a regular file physically inside the repo (no symlink on any
  // segment), under the byte cap; anything else is null plus one diagnostic.
  const reported = new Set();
  const readSource = (rel) => {
    const abs = join(realRoot, rel);
    const why = !regularFileInside(realRoot, abs) ? "is not a regular file inside the repo (a symlink, a directory, or missing)" : lstatSync(abs).size > MAX_SOURCE_BYTES ? `is over ${MAX_SOURCE_BYTES / 1024} KiB` : null;
    if (why) {
      if (!reported.has(rel)) diagnostics.push(`${rel} ${why} — not read`);
      reported.add(rel);
      return null;
    }
    return readFileSync(abs, "utf8");
  };
  const exists = (rel) => regularFileInside(realRoot, join(realRoot, rel));
  const resolveImport = (fromRel, source) => {
    const base = source.startsWith("@/") ? posix.join(srcAliasRoot, source.slice(2)) : posix.normalize(posix.join(posix.dirname(fromRel), source));
    if (base.startsWith("../") || base === "..") return null;
    for (const ext of ["", ...RESOLVE_EXTS]) {
      const candidate = base + ext;
      if (/\.(tsx?|jsx?)$/.test(candidate) && exists(candidate)) return candidate;
    }
    return null;
  };

  if (!exists(routesFile)) {
    diagnostics.push(`${routesFile} not found — nothing to inventory`);
    return { records: [], diagnostics };
  }
  const text = readSource(routesFile);
  if (text === null) return { records: [], diagnostics };
  const routes = parseRouteTree(text, diagnostics);
  const imports = importMap(text);

  // Refs of one file plus its one-hop local imports, memoised per file.
  const scanned = new Map();
  const refsOfFile = (rel) => {
    if (scanned.has(rel)) return scanned.get(rel);
    const refs = new Set();
    scanned.set(rel, refs);
    const body = readSource(rel);
    if (body === null) return refs;
    for (const p of scanApiCalls(body)) refs.add(`?route:${p}`);
    const scan = scanFileText(lex(body).code);
    for (const name of scan.fromNames) refs.add(`?from:${name}`);
    for (const name of scan.rpcNames) refs.add(`?function:${name}`);
    return refs;
  };
  const refsOfElement = (rel) => {
    const refs = new Set(refsOfFile(rel));
    const body = readSource(rel);
    if (body === null) return refs;
    for (const source of localImportSources(lex(body).code)) {
      const target = resolveImport(rel, source);
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
    const source = r.lazy ?? (r.element ? imports.get(r.element.split(".")[0]) : undefined);
    const isLocal = source && (source.startsWith(".") || source.startsWith("@/"));
    const elementFile = isLocal ? resolveImport(routesFile, source) : null;
    if (isLocal && !elementFile) diagnostics.push(`${routesFile}: ${r.element ?? "lazy route"} imports '${source}', which resolves to no file — routes file kept as resource`);
    const resource = elementFile ? [elementFile, routesFile] : [routesFile];
    const refs = elementFile ? refsOfElement(elementFile) : new Set();
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
      refs: [...refs],
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
  return { records, diagnostics };
}
