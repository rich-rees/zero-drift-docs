// A repo-relative option path, the way every starter checks one. An option
// such as `roots` or `migrationsDirs` is the adapter's own, so its rule is
// the adapter's too: no absolute path, no drive letter, no URL scheme, no
// backslash, no whitespace or control character, no `..` segment. A path
// that could escape is refused up front, before any read. The `io` derive
// hands in still refuses to read outside the repo whatever an adapter does:
// this is the adapter's own first line, not the core's guard.

export function repoRelative(value, label) {
  const bad = () => {
    throw new Error(`${label} '${value}' must be repo-relative (no absolute path, drive letter, URL scheme, backslash or '..')`);
  };
  if (typeof value !== "string" || !value.length) bad();
  // Whitespace and control characters: browsers strip them when parsing a
  // URL, so " javascript:x" would read as a scheme after a naive test.
  if (/[\s\x00-\x1f\x7f]/.test(value)) bad();
  if (value.includes("\\") || value.startsWith("/") || /^[A-Za-z]:/.test(value)) bad();
  // A URL scheme is not a path either: a first segment holding ':' is refused.
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)) bad();
  const segs = value.split("/").filter((s) => s !== "" && s !== ".");
  if (segs.some((s) => s === "..")) bad();
  return segs.length ? segs.join("/") : ".";
}
