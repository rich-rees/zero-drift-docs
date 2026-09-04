// Repo-relative path discipline, shared by config loading, the deriver and
// every built-in extractor. Everything the engine reads or writes on behalf
// of an adopter is named in zdd/config.json, and every such name must stay
// inside the adopter's checkout: no absolute paths, no drive letters, no UNC,
// no backslashes, no `..` segment. A path that could escape is refused up
// front rather than discovered as a read of a sibling checkout or a write over
// package.json (DIO-309 review CR-003..CR-006). Symlinks inside the repo are
// not policed here — an adopter who links their own tree elsewhere owns that.

import { relative, resolve, isAbsolute, sep } from "node:path";

export function repoRelative(value, label) {
  const bad = () => {
    throw new Error(`${label} '${value}' must be repo-relative (no absolute path, drive letter, URL scheme, backslash or '..')`);
  };
  if (typeof value !== "string" || !value.length) bad();
  // No whitespace or control characters anywhere: browsers strip them when
  // parsing a URL, so " javascript:x" or "java\nscript:x" would read as a
  // scheme after passing a naive test (CR-002 verification).
  if (/[\s\x00-\x1f\x7f]/.test(value)) bad();
  if (value.includes("\\") || value.startsWith("/") || /^[A-Za-z]:/.test(value)) bad();
  // A URL scheme is not a path either: `javascript:alert(1)` as a map
  // resource would become a clickable source link in the hosted index
  // (DIO-310 review CR-002). A first segment containing ':' is refused.
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)) bad();
  const segs = value.split("/").filter((s) => s !== "" && s !== ".");
  if (segs.some((s) => s === "..")) bad();
  return segs.length ? segs.join("/") : ".";
}

// Two repoRelative() names overlap when one is the other or an ancestor of
// it (`.` is the root, so it overlaps everything). The layout rule in
// lib/config.mjs is built on this: a folder the engine prunes or a file it
// writes may not share ground with anything else it is told about (CR-059).
export function overlaps(a, b) {
  if (a === "." || b === ".") return true;
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

// Resolve <repoRoot>/<rel> and prove the result stays inside repoRoot — the
// belt behind repoRelative's braces, for paths assembled from several parts.
// Compared segment-wise through path.relative (so `repo2` is not inside
// `repo`, and `..foo` is not an escape), and case-folded ONLY on the
// platforms whose filesystems fold case: on Linux `/srv/repo` and `/srv/Repo`
// are different directories, and folding there accepted a case-variant
// sibling checkout as "inside" (CR-067).
const FOLDS_CASE = process.platform === "win32" || process.platform === "darwin";
const fold = (s) => (FOLDS_CASE ? s.toLowerCase() : s);

export function insideRepo(repoRoot, abs, label) {
  const r = relative(fold(resolve(repoRoot)), fold(resolve(abs)));
  if (r === ".." || r.startsWith(`..${sep}`) || isAbsolute(r)) {
    throw new Error(`${label} resolves outside the repo: ${abs}`);
  }
  return abs;
}
