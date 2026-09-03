// Deterministic directory walk shared by the extractors: sorted names,
// symlink-cycle safe. Directory symlinks are followed (an adopter who links
// part of their own tree still wants it inventoried) but each real directory
// is visited once, so a link to an ancestor cannot recurse forever (CR-016).
import { readdirSync, statSync, realpathSync } from "node:fs";
import { join } from "node:path";

export function walkDir(dir, onFile, seen = new Set(), shouldEnter = () => true) {
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
    if (statSync(p).isDirectory()) {
      if (shouldEnter(p, name)) walkDir(p, onFile, seen, shouldEnter);
    } else onFile(p, name);
  }
}
