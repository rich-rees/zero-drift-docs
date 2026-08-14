// Frontmatter parser for semantic-map concepts (extracted from render.mjs for
// DIO-148). Same deliberately-minimal subset as the v1 renderer.
//
// Input is CRLF-normalized before parsing: Windows checkouts with
// core.autocrlf=true (the Git-for-Windows default) rewrite the committed LF
// files to CRLF, and both the frontmatter fence regex and per-line splitting
// are newline-sensitive. Normalizing here also keeps the renderer's outputs
// byte-identical across checkout eol settings (render.mjs is contractually
// deterministic). CI never catches the CRLF case itself — Linux runners
// check out LF — hence the unit tests in test/frontmatter.test.mjs.

export function parseFrontmatter(text) {
  const normalized = text.replace(/\r\n/g, "\n");
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(normalized);
  if (!m) return null;
  const fm = {};
  for (const line of m[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx < 1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (/^["'].*["']$/.test(value)) value = value.slice(1, -1);
    if (key === "tags") {
      const list = /^\[(.*)\]$/.exec(value);
      fm.tags = list
        ? list[1].split(",").map((t) => t.trim()).filter(Boolean)
        : value ? [value] : [];
    } else {
      fm[key] = value;
    }
  }
  return { frontmatter: fm, body: normalized.slice(m[0].length) };
}
