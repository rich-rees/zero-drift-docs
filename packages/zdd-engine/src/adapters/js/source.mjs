// The JavaScript and TypeScript source model the JS adapters share
// (decision 0037): a helper folder, not an adapter (no index.mjs). One lexer
// for every JS adapter, so a route adapter, a screen adapter and a
// data-access adapter agree on what a file's code is — a call spelled inside
// a comment, a string or a regex literal is never one — and on where its
// top-level statements start and what each declares, so a screen's
// `?code:<file>#<name>` names the same text a data-access adapter read.
// Also here: the module's imports (what a named import asks for, and how a
// named import narrows the module to what those names reach), and the API
// calls a piece of code makes (`api.get("/users")`, `fetch("/v1/x")`):
// structure, not data access. Purely textual — no TypeScript parser — and
// deterministic: same bytes in, same answers out.

import { expandTemplatePath } from "../../core/lib/template-paths.mjs";

export const RESOLVE_EXTS = [".tsx", ".ts", ".jsx", ".js", "/index.tsx", "/index.ts", "/index.jsx", "/index.js"];
export const MAX_SOURCE_BYTES = 1024 * 1024;

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
      const wordBefore = (end) => {
        let w = end;
        while (w >= 0 && /\s/.test(mask[w])) w--;
        let ws = w;
        while (ws >= 0 && /[A-Za-z_$\d]/.test(mask[ws])) ws--;
        // `client.if(x)` — or `client. if(x)`, `client./*c*/if(x)` (the mask
        // has blanked the comment) — is a member call, not a keyword (CR-027).
        let dot = ws;
        while (dot >= 0 && /\s/.test(mask[dot])) dot--;
        return { word: mask[dot] === "." ? "" : text.slice(ws + 1, w + 1), before: ws };
      };
      const { word, before } = wordBefore(j - 1);
      if (["if", "while", "for", "with"].includes(word)) return true;
      return word === "await" && wordBefore(before).word === "for"; // `for await (...) /re/`
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
  const tplOpens = new Set(); // offsets of backticks that OPEN a template (1.3.0 CR-017)
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
      tplOpens.add(i);
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
    // A `/` followed by `>` is JSX's self-closing tag, never a regex: after
    // `name={r} />` the `}` makes a regex "allowed", and the blanked run then
    // ate the closing braces of every component body (2.1.0).
    if (ch === "/" && next !== ">" && regexAllowed(i)) {
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
  return { code: code.join(""), mask: mask.join(""), tplOpens };
}

// Index just past the bracket closing the one opened at `open`, on the mask.
export function matchBracket(mask, open) {
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
export function skipJsx(mask, i) {
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
export function model(text) {
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
  // A divider (`----- Section -----`, `=====`, `//// Inputs ////`) heads a
  // section of the file; it is never prose, so it ends the block, and what
  // sits above it describes the section, not this declaration.
  const isDivider = (t) => !/[A-Za-z0-9]/.test(t) || /^[^A-Za-z0-9\s]{3,}.*[^A-Za-z0-9\s]{3,}$/.test(t);
  const commentAbove = (at) => {
    const found = [];
    for (let k = lineOf(at) - 1; k >= 0 && commentLine[k] !== null; k--) {
      if (commentLine[k] && isDivider(commentLine[k])) break;
      found.push(commentLine[k]);
    }
    return found.reverse().filter(Boolean).join(" ");
  };
  return { text, code, mask, commentAbove };
}

export const stringAt = (m, i) => {
  // `i` is a quote on the mask; the body is the original text up to the next
  // matching delimiter on the mask.
  const q = m.mask[i];
  const end = m.mask.indexOf(q, i + 1);
  return end === -1 ? null : m.text.slice(i + 1, end);
};
export const firstNonSpace = (mask, i) => {
  while (i < mask.length && /\s/.test(mask[i])) i++;
  return i;
};

// ---------------------------------------------------------------------------
// Imports and top-level statements
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
// Identifiers as ECMAScript spells them — not ASCII only, so
// `import { café }` is a name, never a silent miss (1.3.0 CR-019).
export const ID = "[\\p{ID_Start}$_][\\p{ID_Continue}$\\u200C\\u200D]*";
const ID_RE = new RegExp(`^${ID}$`, "u");

// Every local runtime import of a file (relative or `@/`), in first-seen
// order, with what it binds (1.3.0): `names` is the set of exported names
// the named imports ask for (`import { a, b as c }` asks for a and b; a
// side-effect `import "./x"` or `import {} from` asks for none — the
// module's top-level code still runs), or null when the import takes the
// module whole — a default or namespace import, a dynamic import(), or a
// specifier the scan cannot read — with `how` saying which. An import of
// types only (`import type`, `import { type A }`) is erased by TypeScript
// and binds nothing (CR-018). Structure is found on the MASK (comments and
// string bodies blanked), so an import spelled inside a string is not one
// (CR-020); the module specifier is read from the text at the same offsets.
export function localImports(text) {
  const { mask } = lex(text);
  const out = new Map();
  const note = (src, names, how) => {
    if (!(src.startsWith(".") || src.startsWith("@/"))) return;
    const prev = out.get(src);
    if (prev && prev.names === null) return;
    out.set(src, names === null ? { names: null, how } : { names: new Set([...(prev?.names ?? []), ...names]), how: null });
  };
  const literal = (q) => {
    const end = mask.indexOf(mask[q], q + 1);
    return end === -1 ? null : text.slice(q + 1, end);
  };
  const re = /\bimport\s*(?:(type\s+)?([^;'"`]*?)\s*\bfrom\s*|)(['"])|\bimport\(\s*(['"])/g;
  for (const m of mask.matchAll(re)) {
    if (m[4] !== undefined) {
      const src = literal(m.index + m[0].length - 1);
      if (src !== null) note(src, null, "through import()");
      continue;
    }
    const src = literal(m.index + m[0].length - 1);
    if (src === null || m[1]) continue; // `import type … from`
    if (m[2] === undefined) {
      note(src, [], null); // `import "./x"`: top-level code only
      continue;
    }
    const clause = m[2];
    const brace = /\{([^}]*)\}/.exec(clause);
    const outside = clause.replace(/\{[^}]*\}/, "").replace(/,/g, " ").trim();
    if (/\*\s*as\b/.test(outside)) {
      note(src, null, "as a namespace");
      continue;
    }
    if (outside) {
      note(src, null, "by default import");
      continue;
    }
    const specs = (brace ? brace[1] : "").split(",").map((s) => s.trim()).filter(Boolean);
    if (specs.length && specs.every((s) => /^type\s/.test(s))) continue; // types only: erased
    const names = [];
    let unreadable = null;
    for (const seg of specs) {
      if (/^type\s/.test(seg)) continue;
      const [name, ...rest] = seg.split(/\s+as\s+/);
      if (ID_RE.test(name) && rest.length <= 1 && (!rest.length || ID_RE.test(rest[0]))) names.push(name);
      else unreadable ??= seg;
    }
    if (unreadable !== null) note(src, null, `with a specifier the scan cannot read ('${unreadable.slice(0, 40)}')`);
    else note(src, names, null);
  }
  return out;
}

// A module's top-level statements, found on the mask. A statement starts on
// a line at bracket depth 0:
//   - at column 0, on a character that cannot continue the line before (not
//     a closer, a dot, or a template's CLOSING backtick — an opening one
//     starts a statement, CR-017);
//   - indented, when its first word is a declaration keyword;
//   - indented, when the line cannot continue the one before: it does not
//     open with `.`, an operator or a closer, and the line before does not
//     end with an operator, `=>`, an opener or a comma. An indented
//     statement that is really a continuation is then counted as `code`,
//     which only ever adds refs — the "might touch" side (decision 0011).
// It runs to the next start. Template bodies are blanked on the mask, so a
// line inside one never starts a statement. Each statement is classified:
//   decl      a function / class / const / let / var / enum, by local name
//             — every name a `const a = …, b = …` or a destructuring
//             (`const { a, b: c } = …`) binds (CR-061); `export default …`
//             declares the local name "default"
//   type      an erased declaration that still binds a name an import may
//             ask for: `declare …` (ambient) and `export default interface`
//             (CR-046) — no code runs, so it mentions nothing and is no unit
//   exports   `export { a as b }` — exported name → local name
//   reexport  `export { a } from "…"` / `export * from "…"` — names (or *)
//             another module declares
//   code      anything else that is not an import or a type: runs on import
export function topLevel(text) {
  const { code, mask, tplOpens } = lex(text);
  const starts = [];
  let depth = 0;
  // How the last non-blank line ENDED: its masked text if it ended at depth
  // 0, else "{" (a line ending inside brackets is always continued).
  let lastLineEnd = "";
  let lineFrom = 0;
  const CONTINUES_NEXT = /(?:[=+\-*/%&|^,?:(\[{<>!~]|=>|\b(?:return|new|await|yield|typeof|in|of|instanceof|extends|delete|void|throw|case|else))$/;
  for (let i = 0; i < mask.length; i++) {
    const ch = mask[i];
    if (depth === 0 && i === lineFrom) {
      const eol = mask.indexOf("\n", i);
      const line = mask.slice(i, eol === -1 ? mask.length : eol);
      const lead = line.search(/\S/);
      if (lead === 0) {
        if (!/[})\].`]/.test(ch) || (ch === "`" && tplOpens.has(i))) starts.push(i);
      } else if (lead > 0) {
        const first = line[lead];
        if (/^(?:export|import|function|async|class|const|let|var|enum)\b/.test(code.slice(i + lead, i + lead + 12))) starts.push(i);
        else if (!/[.?:+\-*/%&|^=,<>)\]}]/.test(first) && !(first === "`" && !tplOpens.has(i + lead)) && !CONTINUES_NEXT.test(lastLineEnd)) starts.push(i);
      }
    }
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth = Math.max(0, depth - 1);
    if (ch === "\n") {
      const line = mask.slice(lineFrom, i).trimEnd();
      if (line.trim()) lastLineEnd = depth === 0 ? line : "{";
      lineFrom = i + 1;
    }
  }
  const statements = [];
  const decls = new Map(); // local name -> [statement index]
  const exportsMap = new Map(); // exported name -> local name
  const reexported = new Set();
  let reexportAll = false;
  const names = []; // statement index -> the names it declares, in order
  const declare = (name, k) => {
    if (!decls.has(name)) decls.set(name, []);
    decls.get(name).push(k);
    (names[k] ??= []).push(name);
  };
  const exportList = (body, fn) => {
    for (const part of body.split(",")) {
      const seg = part.trim().replace(/^type\s+/, "");
      if (!seg) continue;
      const [local, exported] = seg.split(/\s+as\s+/);
      fn(local, exported ?? local);
    }
  };
  const DECL = new RegExp(`^(export\\s+)?(declare\\s+)?(?:(?:async\\s+)?function\\s*\\*?\\s*|(?:abstract\\s+)?class\\s+|(?:const\\s+)?enum\\s+|(?:const|let|var)\\s+)(${ID})?`, "u");
  const DEFAULT = new RegExp(`^export\\s+default\\s+(?:async\\s+)?(?:function\\s*\\*?|(?:abstract\\s+)?class)\\s*(${ID})?`, "u");
  const NAME = new RegExp(`^${ID}`, "u");
  const IDS = new RegExp(`${ID}`, "gu");
  // The names one `const` / `let` / `var` statement binds, on the mask: each
  // declarator split at the commas outside brackets, a plain name (followed
  // by `:`, `=`, `!` or the end — so `Map<string, number>`'s `number` is no
  // declarator) or a destructuring pattern's bound names (a key before `:`
  // and a default value after `=` bind nothing).
  const bindings = (from, to) => {
    const names = [];
    let d = 0;
    let piece = from;
    const take = (a, b) => {
      const t = mask.slice(a, b).trim();
      const plain = NAME.exec(t);
      if (plain && /^\s*(?:[:=!]|$)/.test(t.slice(plain[0].length))) names.push(plain[0]);
      else if (t[0] === "{" || t[0] === "[") {
        const close = matchBracket(t, 0);
        // Blank each default value (`= f(x, y)`) to the next comma at the
        // pattern's own depth, so a name inside it is never bound.
        let inner = "";
        let dd = 0;
        let inDefault = false;
        for (const c of t.slice(1, close - 1)) {
          if (c === "(" || c === "[" || c === "{") dd++;
          else if (c === ")" || c === "]" || c === "}") dd--;
          if (dd === 0 && c === "=") inDefault = true;
          else if (dd === 0 && c === ",") inDefault = false;
          inner += inDefault ? " " : c;
        }
        for (const id of inner.matchAll(IDS)) if (!/^\s*:/.test(inner.slice(id.index + id[0].length))) names.push(id[0]);
      }
    };
    for (let i = from; i < to; i++) {
      const ch = mask[i];
      if (ch === "(" || ch === "[" || ch === "{") d++;
      else if (ch === ")" || ch === "]" || ch === "}") d--;
      else if (d === 0 && ch === ";") break;
      else if (d === 0 && ch === ",") {
        take(piece, i);
        piece = i + 1;
      }
    }
    take(piece, to);
    return names;
  };
  starts.forEach((start, k) => {
    const end = k + 1 < starts.length ? starts[k + 1] : mask.length;
    const s = code.slice(start, end).trimStart();
    let kind = "code";
    let m;
    if (/^import\b/.test(s) || /^(?:export\s+)?(?:declare\s+)?(?:type|interface)\b/.test(s)) kind = "skip";
    else if ((m = /^export\s+default\s+interface\b/.exec(s))) {
      kind = "type";
      declare("default", k);
      exportsMap.set("default", "default");
    }
    else if (/^export\s*\*/.test(s)) {
      kind = "skip";
      reexportAll = true;
    } else if ((m = /^export\s*(?:type\s*)?\{([^}]*)\}\s*from\b/.exec(s))) {
      kind = "skip";
      exportList(m[1], (_local, exported) => reexported.add(exported));
    } else if ((m = /^export\s*\{([^}]*)\}/.exec(s))) {
      kind = "skip";
      exportList(m[1], (local, exported) => exportsMap.set(exported, local));
    } else if ((m = DEFAULT.exec(s)) || /^export\s+default\b/.test(s)) {
      kind = "decl";
      declare("default", k);
      exportsMap.set("default", "default");
      if (m?.[1]) declare(m[1], k);
    } else if ((m = DECL.exec(s)) && (m[3] || /^(?:export\s+)?(?:declare\s+)?(?:const|let|var)\s*[{[]/.test(s))) {
      kind = m[2] ? "type" : "decl";
      const lead = start + (code.slice(start, end).length - s.length);
      const kw = /^(?:export\s+)?(?:declare\s+)?(const|let|var)\s+/.exec(s);
      const names = kw && !/^(?:export\s+)?(?:declare\s+)?const\s+enum\b/.test(s) ? bindings(lead + kw[0].length, end) : [m[3]];
      for (const name of names.length ? names : [m[3]].filter(Boolean)) {
        declare(name, k);
        if (m[1]) exportsMap.set(name, name);
      }
    }
    statements.push({ start, end, kind, names: names[k] ?? [] });
  });
  // The top-level names each statement mentions (on the mask: never in a
  // comment or a string, never as a property after a dot).
  const mentionRe = new RegExp(`(?<![.\\p{ID_Continue}$])${ID}`, "gu");
  for (const st of statements) {
    st.mentions = new Set();
    if (st.kind === "type") continue; // erased: it runs nothing, so it reaches nothing
    for (const id of mask.slice(st.start, st.end).matchAll(mentionRe)) if (decls.has(id[0])) st.mentions.add(id[0]);
  }
  return { text, mask, statements, decls, exportsMap, reexported, reexportAll };
}

// The statements the named imports `names` reach: every `code` statement
// (it runs on import whatever is imported), the statements declaring each
// name, and every top-level declaration any included statement mentions —
// followed to a fixed point, which a visited set bounds (CR-017: a helper a
// top-level call reaches counts too). Returns { statements: Set<index> }, or
// { whole: reason, name } when a name cannot be narrowed: declared by no
// statement here, or re-exported from another module (one hop).
export function narrowModule(mod, names) {
  const include = new Set();
  const todo = [];
  const take = (k) => {
    if (include.has(k)) return;
    include.add(k);
    for (const id of mod.statements[k].mentions) todo.push(id);
  };
  for (const name of [...names].sort()) {
    const local = mod.exportsMap.get(name);
    if (local !== undefined && mod.decls.has(local)) todo.push(local);
    else if (mod.reexported.has(name) || mod.reexportAll) return { whole: "reexport", name };
    else return { whole: "missing", name };
  }
  mod.statements.forEach((s, k) => s.kind === "code" && take(k));
  const visited = new Set();
  while (todo.length) {
    const local = todo.pop();
    if (visited.has(local)) continue;
    visited.add(local);
    for (const k of mod.decls.get(local) ?? []) take(k);
  }
  return { statements: include };
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
// string); the path is read from the original text. A `${hole}` whose type
// the surrounding text states as a union of string literals expands to one
// path per literal (decision 0019); `context` is the text that may hold the
// declaration — the whole module when `text` is one statement of it.
export function scanApiCalls(text, context = text) {
  const m = model(text);
  const out = new Set();
  // `\bfetch`, but `.get` on ANY receiver — `client().get(…)` has no word
  // character before the dot (1.3.0).
  const re = /(?:\bfetch|\.(?:get|post|put|patch|delete|request)(?:<(?:[^<>()]|<[^<>()]*>)*>)?)\(\s*(['"`])/g;
  for (const hit of m.mask.matchAll(re)) {
    const q = hit.index + hit[0].length - 1;
    const raw = stringAt(m, q);
    if (raw === null) continue;
    // A leading `${base}` is a host or prefix, never a path segment: dropped
    // before expansion, so an expandable first hole is still read.
    const stripped = raw.replace(/^\$\{[^}]*\}(?=\/)/, "");
    for (const url of expandTemplatePath(stripped, context)) {
      const path = normalizeApiPath(url);
      if (path.startsWith("/") && path !== "/") out.add(path);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Code units: what `?code:<file>#<name>` names in a JS module (decision 0037)
// ---------------------------------------------------------------------------
// A route or screen adapter names the code it runs, and a data-access
// adapter names the code that reaches the database, in the same units, so
// the core can join them. A top-level declaration is its local name
// (`export default function Foo` is `Foo`; an anonymous default is
// `default`); every other statement that runs on import is MODULE_UNIT, the
// module's own top-level code. An import, a type or an export list is no
// unit (null). `?code:<file>#*` names every unit in the file.
export const MODULE_UNIT = "<module>";
export function codeUnits(mod) {
  // A declaration's unit is the first name it declares itself, "default"
  // only when it declares no other (`export default function Foo` is Foo).
  return mod.statements.map((s) => (s.kind === "code" ? MODULE_UNIT : s.kind === "decl" ? (s.names.find((n) => n !== "default") ?? s.names[0] ?? null) : null));
}

// ---------------------------------------------------------------------------
// Files: the JS and TS source under `roots`, read through io (decision 0010)
// ---------------------------------------------------------------------------
export const DEFAULT_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
export const DEFAULT_EXCLUDE_DIRS = ["node_modules", ".git", ".next", "dist", "build", "coverage"];
// Tests reference tables wholesale for setup and assertions: those edges
// describe the harness, not the app's data flow (the nextjs refs rule).
export const DEFAULT_EXCLUDE_SUFFIXES = [".test.ts", ".test.tsx", ".test.js", ".test.jsx", ".spec.ts", ".spec.tsx", ".spec.js", ".spec.jsx", ".d.ts"];
export function jsFiles(io, roots, { extensions = DEFAULT_EXTENSIONS, excludeDirs = DEFAULT_EXCLUDE_DIRS, excludeSuffixes = DEFAULT_EXCLUDE_SUFFIXES } = {}, diagnostics = [], warnings = diagnostics) {
  const out = new Set();
  const wanted = (name) => extensions.some((e) => name.endsWith(e)) && !excludeSuffixes.some((s) => name.endsWith(s));
  for (const root of roots) {
    const r = io.read(root);
    if (r.ok) {
      if (wanted(root.split("/").pop())) out.add(root);
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
      if (wanted(name)) out.add(rel);
    }, { enter: (_rel, name) => name !== ".git" && !excludeDirs.includes(name) });
    if (!walked.exists) diagnostics.push(`${root}: not a directory inside the repo — skipped`);
    for (const s of walked.skipped) diagnostics.push(`${s.path}: ${s.reason} — skipped`);
    // A partial walk is a partial inventory: said on every derive, never a
    // quiet diagnostic (CR-057).
    if (walked.truncated) warnings.push(`${root}: the walk's budget ran out — some files were not read, so their data access is missing; narrow this adapter's roots`);
  }
  return [...out].sort();
}
