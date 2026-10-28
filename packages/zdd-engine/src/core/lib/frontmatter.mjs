// Frontmatter parser for semantic-map concepts (extracted from render.mjs for the CRLF fix). Same deliberately-minimal subset as the v1 renderer.
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

// What a header says that the parser above would read silently wrong
// (ZDD-9, decision 0047): a key written twice (the parser keeps the last)
// and a value that opens with a quote and does not close with the same one
// (the parser strips any pair, so `"high'` reads as `high`). An apostrophe
// inside a value is not a quote. One pass, linear in the header. `line` is
// the file's own, 1-based (the
// opening fence is line 1); [] when there is no header. The parser's output
// is not changed by this: lint reports, and the author fixes the line.
export function headerProblems(text) {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(text.replace(/\r\n/g, "\n"));
  if (!m) return [];
  const out = [];
  const firstLine = new Map();
  m[1].split("\n").forEach((line, i) => {
    const idx = line.indexOf(":");
    if (idx < 1) return;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    const at = i + 2;
    // `read`: what the parser makes of this line's value (it strips a pair
    // of any quotes), so the report names this line's reading even when the
    // key repeats below.
    if (/^["']/.test(value) && (value.length < 2 || value.at(-1) !== value[0])) out.push({ line: at, key, problem: "quotes", read: /^["'].*["']$/.test(value) ? value.slice(1, -1) : value });
    if (firstLine.has(key)) out.push({ line: at, key, problem: "repeated", first: firstLine.get(key) });
    else firstLine.set(key, at);
  });
  return out;
}
