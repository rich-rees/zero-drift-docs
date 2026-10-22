// Moving blessings out of the semantic map into the blessing store, for
// "upgrade ZDD" (ZDD-1, decision 0032). The plugin cannot import the engine
// (it is installed apart, by npx), so the parser below mirrors the engine's
// extractBlessings / structuralLines (packages/zdd-engine/src/lib/map-links.mjs)
// and a test holds the two equal on the same inputs. It also returns each
// item's line range, which the move needs and the engine does not.
//
// Nothing here writes: bootstrap.mjs's upgrade asks for the proposals, shows
// them, and writes on the confirmed run through its Ledger.

import { posix } from "node:path";

const HEADING_RE = /^ {0,3}#{1,6}\s+(.*?)\s*#*\s*$/;
const ITEM_RE = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/;
const CITATION_RE = /\bADR[-\s]?(\d{4})\b/g;

const normalise = (body) => body.replace(/\r\n?/g, "\n");

// Mirror of the engine's structuralLines: lines inside a fenced code block
// or an HTML comment come back empty, so line numbers are kept.
export function structuralLines(body) {
  const out = [];
  let fence = null;
  let inComment = false;
  const step = (raw) => {
    if (inComment) {
      const close = raw.indexOf("-->");
      if (close === -1) return "";
      inComment = false;
      return step(raw.slice(close + 3));
    }
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(raw);
    if (fence) {
      if (f && f[1][0] === fence.char && f[1].length >= fence.len && !/[^\s`~]/.test(raw.slice(f[0].length))) fence = null;
      return "";
    }
    if (f) {
      fence = { char: f[1][0], len: f[1].length };
      return "";
    }
    const stripped = stripComments(raw, (v) => (inComment = v));
    if (stripped === raw) return raw;
    if (inComment) {
      inComment = false;
      const judged = step(stripped);
      inComment = fence === null;
      return judged;
    }
    return step(stripped);
  };
  for (const raw of normalise(body).split("\n")) out.push(step(raw));
  return out;
}

function stripComments(line, setOpen) {
  let s = line;
  for (;;) {
    const open = s.indexOf("<!--");
    if (open === -1) return s;
    const close = s.indexOf("-->", open + 4);
    if (close === -1) {
      setOpen(true);
      return s.slice(0, open);
    }
    s = s.slice(0, open) + s.slice(close + 3);
  }
}

// The frontmatter block's line count (0 when there is none), by the engine's
// rule: `---` on the first line, closed by the next `---` line.
function frontmatterLines(lines) {
  if (lines[0] !== "---") return 0;
  for (let i = 1; i < lines.length; i++) if (lines[i] === "---") return i + 1;
  return 0;
}

// The blessings on one map page, as the engine reads them, with the lines
// each occupies in the page. Each: { text, parts (its lines as written,
// trimmed), adrs, line (body-relative, 1-based — the engine's), first, last
// (page line indices, inclusive), heading (page line index of its Blessings
// heading) }. Also every Blessings section's
// range: { heading, end (exclusive: the next heading, or the page's end) }.
export function findMapBlessings(pageText) {
  const lines = normalise(pageText).split("\n");
  const fm = frontmatterLines(lines);
  const structure = structuralLines(lines.slice(fm).join("\n"));
  const items = [];
  const sections = [];
  let section = null;
  let current = null;
  const flush = () => {
    if (!current) return;
    const text = current.parts.join(" ").trim();
    const adrs = [];
    for (const m of text.matchAll(CITATION_RE)) if (!adrs.includes(m[1])) adrs.push(m[1]);
    items.push({ text, parts: current.parts, adrs, line: current.first - fm + 1, first: current.first, last: current.last, heading: section.heading });
    current = null;
  };
  structure.forEach((raw, i) => {
    const at = i + fm;
    const heading = HEADING_RE.exec(raw);
    if (heading) {
      flush();
      if (section) section.end = at;
      section = /^blessings?$/i.test(heading[1].trim()) ? { heading: at, end: lines.length } : null;
      if (section) sections.push(section);
      return;
    }
    if (!section) return;
    const item = ITEM_RE.exec(raw);
    if (item) {
      flush();
      current = { first: at, last: at, parts: [item[1]] };
    } else if (current && raw.trim()) {
      current.parts.push(raw.trim());
      current.last = at;
    } else if (current) {
      flush();
    }
  });
  flush();
  return { items, sections };
}

// A file name from a trigger question: lower case, words joined by `-`, at
// most 60 characters, cut at a word.
export function blessingSlug(question) {
  let s = String(question)
    .toLowerCase()
    .replace(/`/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (s.length > 60) s = s.slice(0, 60).replace(/-[^-]*$/, "");
  return s || "blessing";
}

// The question a blessing opens with, by the engine's rule (blessingShape):
// the text up to the first `?` followed by whitespace or the end, links
// reduced to their text, at most 200 characters, and no sentence before it.
export function triggerQuestion(text) {
  const visible = text
    .replace(/!?\[([^\]]*)\]\((?:<[^>\n]*>|[^)\s]*(?:\([^)\s]*\)[^)\s]*)*)(?:\s+"[^"]*")?\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  const q = /^(.+?\?)(?=\s|$)/.exec(visible);
  return q && q[1].length <= 200 && !/[.!]\s+[A-Z]/.test(q[1]) ? q[1] : null;
}

// What the move proposes for one blessing. `ctx`:
//   page        the map page's repo-relative path
//   pageType    its frontmatter type
//   mapDir, blessingsDir, bundleDir, metadataDir, adrDir   repo-relative
//   isFile(rel) true when a repo file exists there
//   readRecord(rel) the parsed metadata record at that path, or null
// Returns { question, where, symbol, kind, appliesTo, firstBuiltIn, adrs,
// text (links rebased for the store), problem (why it cannot move, or null) }.
export function proposeMove(item, ctx) {
  const question = triggerQuestion(item.text);
  const pageId = posix.relative(ctx.mapDir, ctx.page).replace(/\.md$/, "");
  const found = findWhere(item.text, ctx);
  const problem = !question ? "it opens with no trigger question — add one by hand, then upgrade again" : !found ? "no link or path in it names a repo file to use as where: — add one by hand, then upgrade again" : null;
  return {
    question,
    where: found?.path ?? null,
    symbol: found?.symbol ?? null,
    kind: /\b(extend|reuse|re-use|shared|call)\b/i.test(item.text) ? "extend" : "copy",
    appliesTo: ["Application", "Package"].includes(ctx.pageType) ? pageId : null,
    firstBuiltIn: pageId,
    adrs: item.adrs,
    text: rebaseLinks((item.parts ?? [item.text]).join("\n"), posix.dirname(ctx.page), ctx.blessingsDir),
    problem,
  };
}

// The first link or code span that names a repo file. A link to a metadata
// record names the record's file when it has exactly one; a link to an ADR,
// a map page or a URL is no exemplar. A code span is a repo path; the code
// span right after it, when it is an identifier, is the symbol.
function findWhere(text, ctx) {
  const tokens = [];
  for (const m of text.matchAll(/\]\((<[^>\n]*>|[^)\s]+)(?:\s+"[^"]*")?\)|`([^`\n]+)`/g)) tokens.push(m);
  for (let i = 0; i < tokens.length; i++) {
    const m = tokens[i];
    if (m[1] !== undefined) {
      const dest = m[1].replace(/^<|>$/g, "").replace(/#.*$/, "");
      if (!dest || /^[a-z][a-z0-9+.-]*:/i.test(dest) || dest.startsWith("//")) continue;
      const resolved = dest.startsWith("/") ? posix.normalize(posix.join(ctx.bundleDir === "." ? "" : ctx.bundleDir, dest.replace(/^\/+/, ""))) : posix.normalize(posix.join(posix.dirname(ctx.page), dest));
      if (resolved.startsWith("../")) continue;
      if (under(resolved, ctx.metadataDir) && resolved.endsWith(".json")) {
        const record = ctx.readRecord(resolved);
        const files = Array.isArray(record?.resource) ? record.resource : typeof record?.resource === "string" ? [record.resource] : [];
        if (files.length === 1 && ctx.isFile(files[0])) return { path: files[0], symbol: null };
        continue;
      }
      if (under(resolved, ctx.adrDir) || under(resolved, ctx.mapDir) || /(^|\/)\d{4}-[^/]*\.md$/.test(resolved)) continue;
      if (ctx.isFile(resolved)) return { path: resolved, symbol: null };
      continue;
    }
    const span = m[2].trim();
    if (!/[\/.]/.test(span) || /\s/.test(span)) continue;
    const path = span.replace(/^\.\//, "");
    if (!ctx.isFile(path)) continue;
    const next = tokens[i + 1];
    const gap = next ? text.slice(m.index + m[0].length, next.index) : "";
    const symbol = next && next[2] !== undefined && /^[\s(]*$/.test(gap) && /^[A-Za-z_$][\w$.]*(\(\))?$/.test(next[2].trim()) ? next[2].trim().replace(/\(\)$/, "") : null;
    return { path, symbol };
  }
  return null;
}

const under = (p, dir) => p === dir || p.startsWith(`${dir.replace(/\/+$/, "")}/`);

// Relative link destinations rebased from the page's folder to the store's:
// `../../metadata/x.json` on zdd/map/features/a.md is `../metadata/x.json`
// from zdd/blessings/. A URL, an anchor, and a bundle-absolute `/…` link are
// kept as written.
export function rebaseLinks(text, fromDir, toDir) {
  return text.replace(/\]\((?:<([^>\n]*)>|([^)<>\s]+))((?:\s+"[^"]*")?)\)/g, (whole, angled, bare, title) => {
    const dest = angled ?? bare;
    if (/^[a-z][a-z0-9+.-]*:/i.test(dest) || dest.startsWith("/") || dest.startsWith("#")) return whole;
    const [path, frag = ""] = dest.split(/(?=#)/);
    const moved = posix.relative(toDir, posix.normalize(posix.join(fromDir, path))) || ".";
    return angled !== undefined ? `](<${moved}${frag}>${title})` : `](${moved}${frag}${title})`;
  });
}

// The blessing file's text.
export function blessingFileText(p) {
  const header = [`where: ${p.where}${p.symbol ? ` (${p.symbol})` : ""}`, `kind: ${p.kind}`];
  if (p.appliesTo) header.push(`applies-to: ${p.appliesTo}`);
  if (p.firstBuiltIn) header.push(`first-built-in: ${p.firstBuiltIn}`);
  if (p.adrs.length) header.push(`adr: ${p.adrs.map((n) => `ADR-${n}`).join(", ")}`);
  return `---\n${header.join("\n")}\n---\n\n${p.text}\n`;
}

// The page with the moved items' lines removed. A Blessings section left
// with nothing in it but blank lines loses its heading and those lines too;
// at the end of the page, the blank lines before it go as well. Every other
// byte of the page is kept.
export function removeMoved(pageText, found, moved) {
  const eol = /\r\n/.test(pageText) ? "\r\n" : "\n";
  const lines = normalise(pageText).split("\n");
  const drop = new Set();
  for (const item of moved) for (let i = item.first; i <= item.last; i++) drop.add(i);
  for (const s of found.sections) {
    // Empty means nothing but blank lines is left: a fenced example or a
    // comment kept in the section keeps its heading too.
    let empty = true;
    for (let i = s.heading + 1; i < s.end; i++) if (!drop.has(i) && lines[i].trim()) empty = false;
    if (!empty) continue;
    for (let i = s.heading; i < s.end; i++) drop.add(i);
    const atEnd = lines.slice(s.end).every((l) => !l.trim());
    if (atEnd) for (let i = s.heading - 1; i >= 0 && !lines[i].trim(); i--) drop.add(i);
  }
  const kept = lines.filter((_, i) => !drop.has(i));
  if (lines[lines.length - 1] === "" && kept[kept.length - 1] !== "") kept.push(""); // the page's last newline
  while (kept.length > 1 && kept[kept.length - 1] === "" && kept[kept.length - 2] === "") kept.pop();
  return kept.join(eol);
}
