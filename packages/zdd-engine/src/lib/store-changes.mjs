// Pure parsing for the "stores changed in the latest push" highlight
// (DIO-164, ADR-0034). Git orchestration lives in render.mjs; everything here
// is a deterministic function of its string inputs so it can be unit-tested
// (same split as lib/frontmatter.mjs).

// Glossary term entries are `**Term**:` paragraphs (the same shape viz.js
// promotes to block titles). Returns [{ term, line }] with 1-indexed lines.
export function parseGlossaryTerms(text) {
  const out = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = /^\*\*(.+?)\*\*:/.exec(lines[i]);
    if (m) out.push({ term: m[1], line: i + 1 });
  }
  return out;
}

// Old- and new-side line ranges from a unified diff (-U0 expected, but any
// context width parses). count 0 marks a side untouched by that hunk (pure
// insertion on the old side, pure deletion on the new side).
export function diffRanges(diffText) {
  const out = [];
  for (const m of diffText.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)) {
    out.push({
      old: { start: Number(m[1]), count: m[2] === undefined ? 1 : Number(m[2]) },
      new: { start: Number(m[3]), count: m[4] === undefined ? 1 : Number(m[4]) },
    });
  }
  return out;
}

// Map changed new-side ranges to the glossary terms whose spans they touch.
// A term's span runs from its heading line to the line before the next
// heading; lines above the first term (title, prose preamble) map to no term.
// Returns terms in glossary order, deduplicated.
export function termsForRanges(glossaryText, ranges) {
  const terms = parseGlossaryTerms(glossaryText);
  if (!terms.length) return [];
  const hit = new Set();
  for (const { start, count } of ranges) {
    if (count === 0) continue; // this side untouched by the hunk
    const first = start;
    const last = start + count - 1;
    for (let t = 0; t < terms.length; t++) {
      const spanStart = terms[t].line;
      const spanEnd = t + 1 < terms.length ? terms[t + 1].line - 1 : Infinity;
      if (first <= spanEnd && last >= spanStart) hit.add(terms[t].term);
    }
  }
  // Dedupe by name: the same term can legitimately head more than one entry
  // (e.g. a main definition plus a legacy-section one) — the highlight is
  // name-keyed, so one mention is enough.
  return [...new Set(terms.map((t) => t.term).filter((t) => hit.has(t)))];
}

// The changed-term set for a glossary edit, deletion-aware (Codex review of
// DIO-164): a hunk's new-side range maps to new-glossary terms; its old-side
// range maps to old-glossary terms, which count only if the term still exists
// — so deleting a whole term highlights nothing (ADR-0034: deletions are not
// highlighted, and the untouched neighbor must not inherit the hunk), while a
// deletion INSIDE a surviving term still highlights that term. Returns names
// in new-glossary order.
export function changedTerms(oldText, newText, diffText) {
  const ranges = diffRanges(diffText);
  const hit = new Set(termsForRanges(newText, ranges.map((r) => r.new)));
  const newNames = new Set(parseGlossaryTerms(newText).map((t) => t.term));
  for (const t of termsForRanges(oldText, ranges.map((r) => r.old))) {
    if (newNames.has(t)) hit.add(t);
  }
  return [...new Set(parseGlossaryTerms(newText).map((t) => t.term))].filter((t) => hit.has(t));
}

// `git diff --name-status` output -> changed-ADR list + glossary flag.
// Statuses: A = new, everything else that still exists = updated; deletions
// are skipped (nothing to highlight). Renames (R###\told\tnew) take the new
// path. Only NNNN-*.md files under adrDir count as ADRs (same filter as the
// renderer's loadDocs).
export function parseNameStatus(nameStatusText, glossaryPath, adrDirPrefix) {
  const adrs = [];
  let glossaryChanged = false;
  for (const line of nameStatusText.split("\n")) {
    if (!line.trim()) continue;
    const [status, ...paths] = line.split("\t");
    if (status.startsWith("D")) continue;
    const path = paths[paths.length - 1];
    if (path === glossaryPath) {
      glossaryChanged = true;
    } else if (path.startsWith(adrDirPrefix)) {
      const file = path.slice(adrDirPrefix.length);
      if (/^\d{4}-.+\.md$/.test(file)) {
        adrs.push({ file, status: status.startsWith("A") ? "new" : "updated" });
      }
    }
  }
  adrs.sort((a, b) => (a.file < b.file ? -1 : 1));
  return { adrs, glossaryChanged };
}
