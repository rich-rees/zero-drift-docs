// Links out of a semantic-map concept body, and the blessings section within
// it. Shared by render (the graph's edges), lint (the blessing-citation lint)
// and freshness (which now watches every metadata link, not just `resource:`),
// so the three commands read a concept the same way. Extracted from render.mjs
// for DIO-313 (render.mjs runs render() on import, so nothing is imported from
// it — same reason as frontmatter.mjs).

import { join, resolve, relative } from "node:path";

const posixify = (p) => p.split(/[\\/]/).join("/");

// Map bodies link bundle-absolutely ("/metadata/route/x.json") or relatively
// ("../../metadata/route/x.json") to .md (map) and .json (metadata) targets.
// Node ids are bundle-relative paths minus extension for BOTH layers, so links
// resolve to ids by simple path arithmetic. A link outside the bundle or to a
// URL is not an edge.
export const LINK_RE = /\]\(([^)\s]+\.(?:md|json))(?:#[A-Za-z0-9_-]*)?\)/g;

export function extractLinks(body, docDir, bundleDir) {
  const out = [];
  const seen = new Set();
  for (const m of body.matchAll(LINK_RE)) {
    const target = m[1];
    if (target.includes("://")) continue;
    const abs = target.startsWith("/") ? join(bundleDir, target.slice(1)) : resolve(docDir, target);
    const rel = posixify(relative(bundleDir, abs));
    if (rel.startsWith("..")) continue;
    const id = rel.replace(/\.(md|json)$/, "");
    if (id && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
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
const HEADING_RE = /^#{1,6}\s+(.*?)\s*#*\s*$/;
const ITEM_RE = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/;
const CITATION_RE = /\bADR[-\s]?(\d{4})\b/g;

export function extractBlessings(body) {
  const out = [];
  let inSection = false;
  let current = null;
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const flush = () => {
    if (!current) return;
    const adrs = [];
    for (const m of current.text.matchAll(CITATION_RE)) if (!adrs.includes(m[1])) adrs.push(m[1]);
    out.push({ line: current.line, text: current.text.trim(), adrs });
    current = null;
  };
  lines.forEach((raw, i) => {
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
      current = { line: i + 1, text: item[1] };
    } else if (current && raw.trim()) {
      current.text += " " + raw.trim(); // a wrapped item continues on the next line
    } else if (current) {
      flush(); // a blank line ends the item
    }
  });
  flush();
  return out;
}

// The forward stamps an ADR body carries: "Superseded [in part] by ADR-NNNN",
// in the loose grammar the supersession-symmetry lint accepts (bold or not,
// linked or not, up to 120 chars between the phrase and the number).
const STAMP_RE = /\bsuperseded(\s+in\s+part)?\s+by\b[\s\S]{0,120}?ADR[-\s]?0*(\d+)/gi;

export function forwardStamps(adrText) {
  const out = [];
  for (const m of adrText.matchAll(STAMP_RE)) out.push({ partial: Boolean(m[1]), by: m[2].padStart(4, "0") });
  return out;
}
