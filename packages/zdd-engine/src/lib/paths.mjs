// Repo-relative path discipline, shared by config loading, the deriver and
// every built-in extractor. Everything the engine reads or writes on behalf
// of an adopter is named in zdd/config.json, and every such name must stay
// inside the adopter's checkout: no absolute paths, no drive letters, no UNC,
// no backslashes, no `..` segment. A path that could escape is refused up
// front rather than discovered as a read of a sibling checkout or a write over
// package.json (DIO-309 review CR-003..CR-006). Symlinks inside the repo are
// not policed here — an adopter who links their own tree elsewhere owns that.

export function repoRelative(value, label) {
  const bad = () => {
    throw new Error(`${label} '${value}' must be repo-relative (no absolute path, drive letter, URL scheme, backslash or '..')`);
  };
  if (typeof value !== "string" || !value.length) bad();
  if (value.includes("\\") || value.startsWith("/") || /^[A-Za-z]:/.test(value)) bad();
  // A URL scheme is not a path either: `javascript:alert(1)` as a map
  // resource would become a clickable source link in the hosted index
  // (DIO-310 review CR-002). A first segment containing ':' is refused.
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)) bad();
  const segs = value.split("/").filter((s) => s !== "" && s !== ".");
  if (segs.some((s) => s === "..")) bad();
  return segs.length ? segs.join("/") : ".";
}

// Resolve <repoRoot>/<rel> and prove the result stays inside repoRoot — the
// belt behind repoRelative's braces, for paths assembled from several parts.
export function insideRepo(repoRoot, abs, label) {
  const root = repoRoot.replace(/[\\/]+$/, "");
  const norm = abs.replace(/\//g, "\\");
  const rootNorm = root.replace(/\//g, "\\");
  if (norm !== rootNorm && !norm.toLowerCase().startsWith(rootNorm.toLowerCase() + "\\")) {
    throw new Error(`${label} resolves outside the repo: ${abs}`);
  }
  return abs;
}
