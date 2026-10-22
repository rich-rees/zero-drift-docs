// Splitting one ADR set into an application set and a harness set (ZDD-1,
// decision 0034). Pure functions, so bootstrap.mjs's `split-adrs` command
// and its tests share them: the tag reader, and the link rewrite that keeps
// every link inside the bundle pointing at the same file after the move.

import { posix } from "node:path";

// The set an ADR's tag line names, or null. A tag line is a line that is
// exactly `Scope: harness` or `Scope: product` (or `application`), bold or
// not, in a blockquote or not, with an optional full stop. Prose that starts
// with "Scope:" — One adopter's ADR, "**Scope: a *saved* delivery address is
// not blocked.**" — is an argument, not a tag, and decides nothing.
export function scopeTag(text) {
  for (const raw of String(text).replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.replace(/\*\*|__/g, "").trim().replace(/^>\s*/, "");
    const m = /^Scope:\s*(harness|product|application)\.?$/i.exec(line);
    if (m) return m[1].toLowerCase() === "harness" ? "harness" : "application";
  }
  return null;
}

// A Markdown link destination as the engine reads it: `<…>`, or a bare one
// that may hold balanced brackets, with an optional title.
const LINK = /\]\((?:<([^>\n]*)>|([^()<>\s]*(?:\([^()<>\s]*\)[^()<>\s]*)*))((?:\s+"[^"]*")?)\)/g;

// The text of a file that lived at `oldRel` and now lives at `newRel` (the
// same path when it did not move), its links re-pointed so each still names
// the same file after the moves in `moved` (old repo-relative path -> new).
// A relative link stays relative, a bundle-absolute one (`/adr/x.md`, read
// from `bundleDir`) stays bundle-absolute; a URL, an anchor, and a link to a
// file that did not move from a file that did not move, are kept byte for
// byte. Fenced code is left alone by the caller (outsideFences).
export function repointLinks(text, { oldRel, newRel, moved, bundleDir }) {
  const bundle = bundleDir === "." ? "" : bundleDir;
  return text.replace(LINK, (whole, angled, bare, title) => {
    const dest = angled ?? bare;
    if (!dest || /^[a-z][a-z0-9+.-]*:/i.test(dest) || dest.startsWith("#") || dest.startsWith("//")) return whole;
    const [path, frag = ""] = dest.split(/(?=#)/);
    if (!path) return whole;
    const absolute = path.startsWith("/");
    const target = posix.normalize(absolute ? posix.join(bundle, path.replace(/^\/+/, "")) : posix.join(posix.dirname(oldRel), path));
    const now = moved.get(target) ?? target;
    if (now === target && oldRel === newRel) return whole;
    const next = absolute ? `/${posix.relative(bundle || ".", now)}` : posix.relative(posix.dirname(newRel), now) || posix.basename(now);
    if (next === path) return whole;
    return angled !== undefined ? `](<${next}${frag}>${title})` : `](${next}${frag}${title})`;
  });
}

// Every link in `text` that resolves to one of the moved files' old paths,
// read from a file at `fileRel` outside the bundle: [{ line, link }].
export function linksToMoved(text, { fileRel, moved, bundleDir }) {
  const out = [];
  const bundle = bundleDir === "." ? "" : bundleDir;
  String(text).split(/\r?\n/).forEach((line, i) => {
    for (const m of line.matchAll(LINK)) {
      const dest = m[1] ?? m[2];
      if (!dest || /^[a-z][a-z0-9+.-]*:/i.test(dest) || dest.startsWith("#")) continue;
      const path = dest.split("#")[0];
      const target = posix.normalize(path.startsWith("/") ? posix.join(bundle, path.replace(/^\/+/, "")) : posix.join(posix.dirname(fileRel), path));
      if (moved.has(target)) out.push({ line: i + 1, link: dest });
    }
    for (const old of moved.keys()) if (line.includes(old) && !out.some((o) => o.line === i + 1)) out.push({ line: i + 1, link: old });
  });
  return out;
}
