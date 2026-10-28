// Who imports a file (ZDD-10, decision 0046): the "used by" of an `extend`
// blessing's exemplar, read from the source at render time. The core knows
// no language (decision 0036): each adapter the repo configures may export
// an import reader, `IMPORTS`:
//
//   { label       the languages it reads, a name or a list of names
//     extensions  the file endings it reads
//     skipDirs    folder names that are never source (installed, built)
//     isTest(rel) test code: a user only of test code
//     resolver(io, files) -> (rel, text) -> [repo-relative files it imports] }
//
// The `io` a resolver gets also has `incomplete(why)`: a resolver that
// gives up on something (a config chain past its guard) says so, and the
// answer reads as incomplete.
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

// For each wanted file: { importers: [files], readers, incomplete } when a
// reader claims its ending (importers may be empty: used by nothing), else
// { importers: null, why }. `incomplete` names why the scan could not read
// everything (the walk's or the read budget ran out, a file was too large
// or unreadable), or is null: a scan cut short never reads as "used by
// nothing". Every reader claiming a file's ending reads it, and their
// answers are joined. `limits` lowers the io's caps (the tests).
const ABSENT = new Set(["missing", "ignored"]);
export function importersOf(repoRoot, readers, wanted, { limits = {} } = {}) {
  const result = new Map();
  const labels = readers.flatMap((r) => r.label);
  const why = labels.length ? `it reads the imports of ${labels.length > 1 ? `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}` : labels[0]} files only` : "no extractor this repo uses reads imports";
  const claim = (rel) => readers.filter((r) => r.extensions.includes(extOf(rel)));
  const want = [...new Set(wanted)].sort();
  for (const w of want) result.set(w, claim(w).length ? { importers: [], readers: claim(w), incomplete: null } : { importers: null, why });
  if (!want.some((w) => result.get(w).importers)) return { users: result, incomplete: null, error: null };
  const ignored = gitIgnoredPredicate(repoRoot);
  if (ignored.error) return { users: result, incomplete: null, error: ignored.error };
  const io = makeExtractorIo(repoRoot, "importers", { ignored, ...limits });
  const refused = [];
  // Every read, the readers' own (a tsconfig, a package.json) included: a
  // refusal that is not absence makes the answer incomplete.
  const read = (rel, opts) => {
    const r = io.read(rel, opts);
    if (!r.ok && !ABSENT.has(r.code)) refused.push(r);
    return r;
  };
  const notes = [];
  const counted = { ...io, read, incomplete: (why) => notes.push(why) };
  const skip = new Set([".git", ...readers.flatMap((r) => r.skipDirs ?? [])]);
  const files = [];
  const walked = io.walk(".", (rel) => files.push(rel), { enter: (_rel, name) => !skip.has(name) });
  const resolvers = new Map(readers.map((r) => [r, r.resolver(counted, files)]));
  const wantedSet = new Set(want.filter((w) => result.get(w).importers));
  for (const rel of files) {
    const mine = claim(rel);
    if (!mine.length) continue;
    const text = read(rel);
    if (!text.ok) continue;
    // Test code uses test code only: a module's own tests are not what a
    // change to it asks to retest. Each reader judges by its own verdict:
    // a file one reader calls a test may be another's ordinary user.
    const isTest = (reader, f) => reader.isTest?.(f) === true;
    const users = new Set();
    for (const reader of mine) {
      for (const target of resolvers.get(reader)(rel, text.text)) {
        if (!wantedSet.has(target) || users.has(target)) continue;
        if (isTest(reader, rel) && !result.get(target).readers.some((r) => isTest(r, target))) continue;
        users.add(target);
      }
    }
    for (const target of users) result.get(target).importers.push(rel);
  }
  let incomplete = null;
  if (walked.truncated) incomplete = "ZDD's read of the source ran out of budget";
  else if (refused.some((r) => r.code === "over-budget")) incomplete = "ZDD's read of the source ran out of budget";
  else if (refused.length) incomplete = `ZDD could not read ${refused.length === 1 ? "one file" : `${refused.length} files`} (${refused[0].reason})`;
  else if (notes.length) incomplete = [...new Set(notes)].sort()[0];
  for (const v of result.values()) {
    if (!v.importers) continue;
    v.importers.sort();
    v.incomplete = incomplete;
  }
  return { users: result, incomplete, error: null };
}
