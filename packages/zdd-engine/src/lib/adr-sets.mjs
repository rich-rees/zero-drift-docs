// The ADR sets (ZDD-1, decision 0033): the application set (paths.adrDir,
// its index paths.adrIndex) always, and a harness set beside it when the
// config names both paths.harnessAdrDir and paths.harnessAdrIndex. One
// number line runs across both: ADR-0047 is unique whichever folder holds
// it, so a citation, a blessing's reason and a supersession resolve in
// either. Shared by render, lint and tally.

import { readdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";

export const HARNESS_KEYS = ["harnessAdrDir", "harnessAdrIndex"];

// Both harness keys, or neither. Returns an error string or null.
export function harnessPathsError(paths) {
  const given = HARNESS_KEYS.filter((k) => paths[k] !== undefined);
  if (given.length === 1) {
    const missing = HARNESS_KEYS.find((k) => !given.includes(k));
    return `paths.${given[0]} is set but paths.${missing} is not — a harness ADR set needs its folder and its index (decision 0033); set both, or neither`;
  }
  return null;
}

// [{ name, dir, index }], the application set first.
export function adrSets(paths) {
  const sets = [{ name: "application", dir: paths.adrDir, index: paths.adrIndex }];
  if (paths.harnessAdrDir !== undefined && paths.harnessAdrIndex !== undefined) sets.push({ name: "harness", dir: paths.harnessAdrDir, index: paths.harnessAdrIndex });
  return sets;
}

// Every NNNN-*.md file in every set's folder (top level, as lint and tally
// have always read it), sorted by number, then set. Each: { num, file, set,
// dir (repo-relative), abs }. An unlistable folder is in `unreadable`.
export function listAdrFiles(repoRoot, paths) {
  const out = [];
  const unreadable = [];
  for (const set of adrSets(paths)) {
    const abs = resolve(repoRoot, set.dir);
    let names = [];
    try {
      if (existsSync(abs)) names = readdirSync(abs);
    } catch (e) {
      unreadable.push({ dir: set.dir, code: e.code ?? "error" });
      continue;
    }
    for (const file of names.filter((f) => /^\d{4}-.*\.md$/.test(f)).sort()) out.push({ num: file.slice(0, 4), file, set: set.name, dir: set.dir, abs: resolve(abs, file) });
  }
  out.sort((a, b) => (a.num < b.num ? -1 : a.num > b.num ? 1 : a.set < b.set ? -1 : a.set > b.set ? 1 : a.file < b.file ? -1 : 1));
  return { files: out, unreadable };
}
