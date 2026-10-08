// Links out of a semantic-map concept body, and the blessings section within
// it. Shared by render (the graph's edges), lint (the blessing-citation lint)
// and freshness (which now watches every metadata link, not just `resource:`),
// so the three commands read a concept the same way. Extracted from render.mjs
// for DIO-313 (render.mjs runs render() on import, so nothing is imported from
// it — same reason as frontmatter.mjs).
//
// Everything parsed here is untrusted text from the adopter's map and ADRs
// (DIO-313 review CR-020..CR-023): line endings are normalised whichever way
// they come, HTML comments and fenced code are not structure, a heading may be
// indented the 1–3 spaces CommonMark allows, and a supersession stamp is
// recognised only where the corpus writes one — at the start of a line.

import { join, resolve, relative, isAbsolute } from "node:path";

const posixify = (p) => p.split(/[\\/]/).join("/");
const normalise = (text) => text.replace(/\r\n?/g, "\n");

// Map bodies link bundle-absolutely ("/metadata/route/x.json") or relatively
// ("../../metadata/route/x.json") to .md (map) and .json (metadata) targets.
// Node ids are bundle-relative paths minus extension for BOTH layers, so links
// resolve to ids by simple path arithmetic. A link outside the bundle — by
// `..`, by an absolute path, or on Windows by another drive or a UNC share
// (where path.relative answers with an absolute path, not `..`; CR-023) — or
// to a URL is not an edge.
//
// A destination is read as CommonMark reads it (CAS-96, from CAS-94): either
// `<…>` (no line break, no unescaped `<` or `>`), or a run with no whitespace
// whose parentheses balance, with `\(` / `\)` escaped. Reading only to the
// first `)` cut `(app)--_layout.json` at `(app` and dropped the link silently;
// Next.js keeps route groups in layout names, so that is a real filename.
const TARGET_RE = /^(.+\.(?:md|json))(?:#[A-Za-z0-9_-]*)?$/;

// The destination after `](` at `start`, or null if none closes there.
function readDestination(s, start) {
  if (s[start] === "<") {
    let t = "";
    for (let i = start + 1; i < s.length; i++) {
      const c = s[i];
      if (c === "\\" && i + 1 < s.length && /[!-/:-@[-`{-~]/.test(s[i + 1])) t += s[++i];
      else if (c === ">") return s[i + 1] === ")" ? t : null;
      else if (c === "<" || c === "\n" || c === "\r") return null;
      else t += c;
    }
    return null;
  }
  let t = "";
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (c === "\\" && i + 1 < s.length && /[!-/:-@[-`{-~]/.test(s[i + 1])) t += s[++i];
    else if (/\s/.test(c) || c < " ") return null;
    else if (c === "(") (depth++, (t += c));
    else if (c === ")") {
      if (depth === 0) return t || null;
      depth--;
      t += c;
    } else t += c;
  }
  return null;
}

export function* linkTargets(body) {
  for (let at = body.indexOf("]("); at !== -1; at = body.indexOf("](", at + 2)) {
    const dest = readDestination(body, at + 2);
    const m = dest === null ? null : TARGET_RE.exec(dest);
    if (m) yield m[1];
  }
}

export function extractLinks(body, docDir, bundleDir) {
  const out = [];
  const seen = new Set();
  for (const target of linkTargets(body)) {
    if (target.includes("://")) continue;
    if (/^(\/\/|[A-Za-z]:)/.test(target)) continue; // a UNC or drive-letter spelling is never a bundle link, on any platform (CR-023)
    // Nor is any backslash: CommonMark unescapes `\\server` to `\server`,
    // which POSIX reads as a relative filename and Windows as a root path —
    // the two platforms would disagree about the edge. Bundle links are POSIX.
    if (target.includes("\\")) continue;
    const abs = target.startsWith("/") ? join(bundleDir, target.slice(1)) : resolve(docDir, target);
    const rel = posixify(relative(bundleDir, abs));
    if (rel === ".." || rel.startsWith("../") || isAbsolute(rel) || /^[A-Za-z]:/.test(rel)) continue;
    const id = rel.replace(/\.(md|json)$/, "");
    if (id && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

// The lines of a markdown body that are STRUCTURE — not inside a fenced code
// block (``` or ~~~, up to three spaces of indent, closed by a fence at least
// as long) and not inside an HTML comment. Non-structure lines are returned
// as empty strings so line numbers are preserved.
export function structuralLines(body) {
  const out = [];
  let fence = null; // { char, len }
  let inComment = false;
  // One pass, one state machine: a comment opener inside a fence is code, a
  // fence marker inside a comment is commentary (CR-033), and whatever is
  // left of a line after a comment closes is judged like a fresh line — so a
  // fence opener right after `-->` still opens a fence (CR-034). An unclosed
  // comment blanks everything to the end.
  const step = (raw) => {
    if (inComment) {
      const close = raw.indexOf("-->");
      if (close === -1) return "";
      inComment = false;
      return step(raw.slice(close + 3));
    }
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(raw);
    if (fence) {
      if (f && f[1][0] === fence.char && f[1].length >= fence.len && !/[^\s`~]/.test(raw.slice(f[0].length))) fence = null;
      return "";
    }
    if (f) {
      fence = { char: f[1][0], len: f[1].length };
      return "";
    }
    const stripped = stripComments(raw, (v) => (inComment = v));
    if (stripped === raw) return raw;
    // A comment was removed: what remains is judged like a fresh line (a
    // fence opener after `<!-- x -->` still opens one). The prefix before an
    // unclosed opener is judged without the comment state, which then resumes.
    if (inComment) {
      inComment = false;
      const judged = step(stripped);
      // If the prefix opened a fence, the "comment" after it sits inside the
      // fence and is code, not a comment (CR-035); otherwise it is open.
      inComment = fence === null;
      return judged;
    }
    return step(stripped);
  };
  for (const raw of normalise(body).split("\n")) out.push(step(raw));
  return out;
}

// Remove every closed `<!-- … -->` from one line; if an opener is left
// unclosed, drop the rest of the line and report the comment as open.
function stripComments(line, setOpen) {
  let s = line;
  for (;;) {
    const open = s.indexOf("<!--");
    if (open === -1) return s;
    const close = s.indexOf("-->", open + 4);
    if (close === -1) {
      setOpen(true);
      return s.slice(0, open);
    }
    s = s.slice(0, open) + s.slice(close + 3);
  }
}

// A blessing is one list item under a heading whose text is "Blessings" (any
// level — PressPlay's proving instance writes `# Blessings`), naming the
// exemplar to copy and the pattern to refuse, citing the ADR that blessed it
// ("per ADR-0012", "[ADR-0012](…)", "ADR-0012"). The section ends at the next
// heading of any level. Returned in document order with the ADR numbers each
// item cites (four-digit, deduped, in order of appearance) and its 1-based
// line number in the body handed in.
const HEADING_RE = /^ {0,3}#{1,6}\s+(.*?)\s*#*\s*$/;
const ITEM_RE = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/;
const CITATION_RE = /\bADR[-\s]?(\d{4})\b/g;

export function extractBlessings(body) {
  const out = [];
  let inSection = false;
  let current = null;
  const flush = () => {
    if (!current) return;
    const text = current.parts.join(" ");
    const adrs = [];
    for (const m of text.matchAll(CITATION_RE)) if (!adrs.includes(m[1])) adrs.push(m[1]);
    out.push({ line: current.line, text: text.trim(), adrs });
    current = null;
  };
  structuralLines(body).forEach((raw, i) => {
    const heading = HEADING_RE.exec(raw);
    if (heading) {
      flush();
      inSection = /^blessings?$/i.test(heading[1].trim());
      return;
    }
    if (!inSection) return;
    const item = ITEM_RE.exec(raw);
    if (item) {
      flush();
      current = { line: i + 1, parts: [item[1]] };
    } else if (current && raw.trim()) {
      current.parts.push(raw.trim()); // a wrapped item continues on the next line
    } else if (current) {
      flush(); // a blank line ends the item
    }
  });
  flush();
  return out;
}

// The shape of one blessing (CAS-96), shared by lint and the blessing index:
//
//   - visible   the text a reader sees: links reduced to their text, so a
//               long URL does not count against the length budget.
//   - question  the trigger question the blessing opens with ("Adding an
//               endpoint?"): a first sentence that ends in `?`, at most
//               QUESTION_MAX characters. null when the blessing opens with
//               anything else; such a blessing cannot be indexed, so lint
//               fails it.
//   - because   the inline reason, "because …" up to the end of its clause,
//               or null. A reason is an ADR citation or this.
export const BLESSING_LENGTH_BUDGET = 300;
const QUESTION_MAX = 200;

export function blessingShape(text) {
  const visible = text
    .replace(/!?\[([^\]]*)\]\((?:<[^>\n]*>|[^)\s]*(?:\([^)\s]*\)[^)\s]*)*)(?:\s+"[^"]*")?\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  const q = /^(.+?\?)(?=\s|$)/.exec(visible);
  const question = q && q[1].length <= QUESTION_MAX && !/[.!]\s+[A-Z]/.test(q[1]) ? q[1] : null;
  const b = /\bbecause\b[^.;—]*/i.exec(visible);
  const because = b ? b[0].trim().replace(/[,\s]+$/, "") : null;
  return { visible, question, because, length: visible.length };
}

// The forward stamps an ADR body carries: a LINE that opens with
// "Superseded [in part] by ADR-NNNN" — optionally as a blockquote and/or in
// bold, linked or bare — which is how every stamp in the corpus is written
// (adr-index.mjs renders the same shape). Prose that merely mentions the
// phrase ("not superseded by ADR-0042", a fenced example, a rejected
// alternative) is not a stamp (CR-021).
const STAMP_LINE_RE = /^ {0,3}(?:>\s*)?(?:\*\*|__)?\s*Superseded( in part)? by\s+\[?ADR-(\d{4})\b/i;

export function forwardStamps(adrText) {
  const out = [];
  for (const line of structuralLines(adrText)) {
    const m = STAMP_LINE_RE.exec(line);
    if (m) out.push({ partial: Boolean(m[1]), by: m[2] });
  }
  return out;
}
