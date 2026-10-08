// Template-literal API paths (decision 0019). `` api.get(`/${plural}/${id}`) ``
// is one call site and several urls. Each `${hole}` is read against the text
// around it: a hole that is a plain identifier whose TypeScript type, in the
// same text, is a union of string literals (`plural: "suppliers" | "carriers"`,
// or `plural: Plural` with `type Plural = "suppliers" | "carriers"`), or whose
// binding is one string literal (`const kind = "jobs"`), expands to those
// values; any other hole is `*`, which the resolver lets stand only on a
// route PARAMETER, never on a fixed word. Purely textual — the same honesty
// as the call scanners that use it: a type declared in another file is not
// seen, and the call then reads as `*`. One ambiguity is accepted: an object
// property `{ plural: "z" }` reads exactly like an annotation `plural: "z"`
// and is taken as one — a literal the file really holds, on the same name.
//
// The product of several union holes is capped: past MAX_EXPANSIONS urls the
// call is left as `*`s rather than fanned into hundreds of refs.

export const MAX_EXPANSIONS = 32;

const IDENT = /^[A-Za-z_$][\w$]*$/;
const LITERAL = /^\s*(['"])([^'"\\]*)\1\s*$/;

// `"a" | 'b' | "c"` -> ["a", "b", "c"]; anything else -> null.
export function parseLiteralUnion(annotation) {
  const parts = annotation.split("|");
  const out = [];
  for (const p of parts) {
    const m = LITERAL.exec(p);
    if (!m) return null;
    out.push(m[2]);
  }
  return out.length ? out : null;
}

// Cut an annotation after the name's `:` at the first token that cannot be
// part of a union of literals — a parameter separator, a default, a closing
// bracket, an arrow or a statement end. Quotes are respected so a literal
// holding `,` or `)` survives.
function annotationAfter(text, at) {
  let i = at;
  let quote = null;
  for (; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === "," || ch === ")" || ch === "=" || ch === ";" || ch === "}" || ch === "\n" || ch === "]" || ch === "{") break;
  }
  return text.slice(at, i);
}

// The literal values an identifier can take, read from `context`: a type
// annotation on the name (parameter or variable), followed one hop to a
// `type X = ...` alias in the same text; else a single-literal `const`.
export function literalValues(name, context) {
  if (!IDENT.test(name)) return null;
  const esc = name.replace(/\$/g, "\\$");
  const ann = new RegExp(`(?<![\\w$.])${esc}\\s*\\??\\s*:\\s*`, "g");
  for (const m of context.matchAll(ann)) {
    const annotation = annotationAfter(context, m.index + m[0].length).trim();
    if (!annotation) continue;
    const direct = parseLiteralUnion(annotation);
    if (direct) return direct;
    if (IDENT.test(annotation)) {
      const alias = new RegExp(`\\btype\\s+${annotation.replace(/\$/g, "\\$")}\\s*=\\s*`);
      const a = alias.exec(context);
      if (a) {
        const body = annotationAfter(context, a.index + a[0].length).trim();
        const values = parseLiteralUnion(body);
        if (values) return values;
      }
    }
  }
  const constant = new RegExp(`\\b(?:const|let|var)\\s+${esc}\\s*=\\s*(['"])([^'"\\\\]*)\\1`).exec(context);
  if (constant) return [constant[2]];
  return null;
}

// Every url one raw template path stands for, holes expanded where the text
// says what they are, `*` elsewhere. Returns at least one url.
export function expandTemplatePath(raw, context) {
  const parts = []; // string | string[] (alternatives)
  let last = 0;
  for (const m of raw.matchAll(/\$\{([^}]*)\}/g)) {
    parts.push(raw.slice(last, m.index));
    const values = literalValues(m[1].trim(), context);
    parts.push(values ?? ["*"]);
    last = m.index + m[0].length;
  }
  parts.push(raw.slice(last));
  let count = 1;
  for (const p of parts) if (Array.isArray(p)) count *= p.length;
  if (count > MAX_EXPANSIONS) return [raw.replace(/\$\{[^}]*\}/g, "*")];
  let urls = [""];
  for (const p of parts) {
    if (typeof p === "string") urls = urls.map((u) => u + p);
    else urls = urls.flatMap((u) => p.map((v) => u + v));
  }
  return [...new Set(urls)];
}
