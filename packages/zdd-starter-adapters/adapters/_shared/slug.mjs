// URL-ish path -> metadata filename slug, shared by every extractor so two
// extractors that emit the same kind land in one filename space.
//   `/` -> `--` between segments (an empty path is `index`),
//   `[p]` / `{p}` / `{p:conv}` -> `_p`,  `[...p]` / `{p:path}` -> `___p`,
//   `.` -> `-`.  Route-group parens are kept where the caller left them.
// Catch-all forms keep their own marker so `/files/{p}` and `/files/{p:path}`
// — two different routes — cannot collide (CR-013). The mapping is not
// injective in general (`/foo.bar` vs `/foo-bar`); a collision is a hard
// error at validation, never a silent overwrite, and the scheme is frozen
// because filenames are part of the metadata contract (v0.3.1 golden).
export function slugify(path) {
  const cleaned = path.replace(/^\/+/, "");
  if (!cleaned) return "index";
  return cleaned
    .split("/")
    .map((seg) =>
      seg
        .replace(/^\[\.\.\.(.+)\]$/, "___$1")
        .replace(/^\[(.+)\]$/, "_$1")
        .replace(/^\{([^:}]+):path\}$/, "___$1")
        .replace(/^\{([^:}]+)(?::[^}]*)?\}$/, "_$1")
        .replace(/\./g, "-"),
    )
    .join("--");
}
