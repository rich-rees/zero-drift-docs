// Deterministic directory walk shared by the extractors: sorted names,
// symlink-cycle safe. Directory symlinks are followed (an adopter who links
// part of their own tree still wants it inventoried) but each real directory
// is visited once, so a link to an ancestor cannot recurse forever (CR-016).
// A link that points nowhere is not a file and not a directory: it is skipped
// and reported through `onSkip(path, reason)` rather than thrown out of the
// extractor as ENOENT (CR-062) — one stale link must not fail derive.
import { readdirSync, statSync, realpathSync } from "node:fs";
import { join } from "node:path";

export function walkDir(dir, onFile, seen = new Set(), shouldEnter = () => true, onSkip = () => {}) {
  let real;
  try {
    real = realpathSync(dir);
  } catch {
    return;
  }
  if (seen.has(real)) return;
  seen.add(real);
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    let st;
    try {
      st = statSync(p); // follows links: a valid directory link is entered
    } catch (e) {
      onSkip(p, e.code === "ENOENT" || e.code === "ENOTDIR" ? "dangling symlink" : `unreadable (${e.code})`);
      continue;
    }
    if (st.isDirectory()) {
      if (shouldEnter(p, name)) walkDir(p, onFile, seen, shouldEnter, onSkip);
    } else onFile(p, name);
  }
}
