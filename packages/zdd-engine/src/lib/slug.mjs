// URL-ish path -> metadata filename slug, shared by every extractor so two
// extractors that emit the same kind land in one filename space.
//   `/` -> `--`,  `[p]` / `{p}` / `{p:conv}` -> `_p`,  `[...p]` -> `___p`,
//   `.` -> `-`.  Route-group parens are kept where the caller left them.
export function slugify(path) {
  const cleaned = path.replace(/^\/+/, "");
  if (!cleaned) return "index";
  return cleaned
    .split("/")
    .map((seg) =>
      seg
        .replace(/^\[\.\.\.(.+)\]$/, "___$1")
        .replace(/^\[(.+)\]$/, "_$1")
        .replace(/^\{([^:}]+)(?::[^}]*)?\}$/, "_$1")
        .replace(/\./g, "-"),
    )
    .join("--");
}
