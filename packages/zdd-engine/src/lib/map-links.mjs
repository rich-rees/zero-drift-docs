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
export const LINK_RE = /\]\(([^)\s]+\.(?:md|json))(?:#[A-Za-z0-9_-]*)?\)/g;

export function extractLinks(body, docDir, bundleDir) {
  const out = [];
  const seen = new Set();
  for (const m of body.matchAll(LINK_RE)) {
    const target = m[1];
    if (target.includes("://")) continue;
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
  const withoutComments = normalise(body).replace(/<!--[\s\S]*?-->/g, (c) => c.replace(/[^\n]/g, ""));
  const out = [];
  let fence = null; // { char, len }
  for (const line of withoutComments.split("\n")) {
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (f && f[1][0] === fence.char && f[1].length >= fence.len && !/[^\s`~]/.test(line.slice(f[0].length))) fence = null;
      out.push("");
      continue;
    }
    if (f) {
      fence = { char: f[1][0], len: f[1].length };
      out.push("");
      continue;
    }
    out.push(line);
  }
  return out;
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
