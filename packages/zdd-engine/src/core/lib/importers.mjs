// Who imports a file (ZDD-10, decision 0046): the "used by" of an `extend`
// blessing's exemplar, read from the source at render time. The core knows
// no language (decision 0036): each adapter the repo configures may export
// an import reader, `IMPORTS`:
//
//   { label       the files it reads, in words ("… files")
//     extensions  the file endings it reads
//     skipDirs    folder names that are never source (installed, built)
//     isTest(rel) test code: a user only of test code
//     resolver(io, files) -> (rel, text) -> [repo-relative files it imports] }
//
// The repo is walked once through an extractor-style `io` (never a path git
// ignores, never through a link, the same caps), each file a reader claims
// is read once, and the answer is inverted for the wanted files only.
// Deterministic: the walk is sorted, and the answer depends only on bytes.

import { makeExtractorIo } from "./extractor-io.mjs";
import { gitIgnoredPredicate } from "./ignored.mjs";

const extOf = (rel) => {
  const base = rel.slice(rel.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot) : "";
};

// The readers among some loaded adapter modules, each once, in the order met.
export function importReaders(modules) {
  const out = [];
  for (const mod of modules) {
    const r = mod?.IMPORTS;
    if (r && typeof r.resolver === "function" && Array.isArray(r.extensions) && !out.includes(r)) out.push(r);
  }
  return out;
}

// For each wanted file: { importers: [files], reader } when a reader claims
// its ending (importers may be empty: used by nothing), else { importers:
// null, why }. `truncated`: the walk's budget ran out, so some importers
// may be missing.
export function importersOf(repoRoot, readers, wanted) {
  const result = new Map();
  const labels = readers.map((r) => r.label);
  const why = labels.length ? `it reads the imports of ${labels.join(", ").replace(/, ([^,]*)$/, " and $1")} files only` : "no extractor this repo uses reads imports";
  const claim = (rel) => readers.find((r) => r.extensions.includes(extOf(rel))) ?? null;
  const want = [...new Set(wanted)].sort();
  for (const w of want) result.set(w, claim(w) ? { importers: [], reader: claim(w) } : { importers: null, why });
  if (!want.some((w) => result.get(w).importers)) return { users: result, truncated: false, error: null };
  const ignored = gitIgnoredPredicate(repoRoot);
  if (ignored.error) return { users: result, truncated: false, error: ignored.error };
  const io = makeExtractorIo(repoRoot, "importers", { ignored });
  const skip = new Set([".git", ...readers.flatMap((r) => r.skipDirs ?? [])]);
  const files = [];
  const walked = io.walk(".", (rel) => files.push(rel), { enter: (_rel, name) => !skip.has(name) });
  const resolvers = new Map(readers.map((r) => [r, r.resolver(io, files)]));
  const wantedSet = new Set(want.filter((w) => result.get(w).importers));
  for (const rel of files) {
    const reader = claim(rel);
    if (!reader) continue;
    const read = io.read(rel);
    if (!read.ok) continue;
    for (const target of resolvers.get(reader)(rel, read.text)) {
      if (!wantedSet.has(target)) continue;
      const entry = result.get(target);
      // Test code uses test code only: a module's own tests are not what a
      // change to it asks to retest.
      if (reader.isTest?.(rel) && !entry.reader.isTest?.(target)) continue;
      entry.importers.push(rel);
    }
  }
  for (const v of result.values()) if (v.importers) v.importers.sort();
  return { users: result, truncated: walked.truncated, error: null };
}
