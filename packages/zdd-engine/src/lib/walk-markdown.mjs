// The one way the store lints and the freshness nudge walk a curated store:
// sorted, symlinks skipped (lstat, never followed — the rule render.mjs
// already keeps, DIO-313 review CR-013/CR-018), filesystem errors swallowed
// per entry, depth and entry counts bounded so a hostile tree cannot recurse
// or enumerate the run to death. Returns absolute paths of regular .md files.
//
// readBounded: a regular file under the byte cap, or null — for a store
// document, a record over the cap is not a document (CR-014/CR-019). The
// caller decides whether null is a diagnostic or a skip.

import { readdirSync, lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const MAX_STORE_FILE_BYTES = 1024 * 1024;
const MAX_DEPTH = 16;
const MAX_ENTRIES = 20_000;

export function walkMarkdown(dir, out = [], state = { depth: 0, entries: 0 }) {
  if (state.depth > MAX_DEPTH) return out;
  let names;
  try {
    if (!lstatSync(dir).isDirectory()) return out; // a symlinked or non-dir root is not a store
    names = readdirSync(dir).sort();
  } catch {
    return out;
  }
  for (const name of names) {
    if (++state.entries > MAX_ENTRIES) return out;
    const p = join(dir, name);
    let st;
    try {
      st = lstatSync(p);
    } catch {
      continue;
    }
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) walkMarkdown(p, out, { depth: state.depth + 1, entries: state.entries });
    else if (st.isFile() && name.endsWith(".md")) out.push(p);
  }
  return out;
}

export function readBounded(path, maxBytes = MAX_STORE_FILE_BYTES) {
  try {
    const st = lstatSync(path);
    if (!st.isFile() || st.size > maxBytes) return null;
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

// True when every path segment from `root` down to `abs` exists without a
// symlink among the existing ones, and `abs` itself is a regular file. The
// physical version of "inside": a linked parent directory would otherwise
// carry a lexically-inside path anywhere on disk (CR-013).
export function regularFileInside(root, abs) {
  try {
    if (!lstatSync(root).isDirectory()) return false; // the root itself may not be a symlink (CR-013)
  } catch {
    return false;
  }
  const rel = abs.slice(root.length).split(/[\\/]/).filter(Boolean);
  let cur = root;
  for (const seg of rel) {
    cur = join(cur, seg);
    let st;
    try {
      st = lstatSync(cur);
    } catch {
      return false;
    }
    if (st.isSymbolicLink()) return false;
  }
  try {
    return lstatSync(abs).isFile();
  } catch {
    return false;
  }
}
