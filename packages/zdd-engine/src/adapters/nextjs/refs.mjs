// Static reference scanner for the nextjs ZDD extractor.
//
// Finds outbound references in TS/TSX source: internal API calls
// (`fetch('/api/...')`). Data access moved to supabase-js in 0.9 (decision
// 0037). Purely textual — no import-graph resolution, no
// type-checking. Wrapper libs (journey-api.ts etc.) keep their refs on their
// own module record rather than propagating to callers: mechanically true,
// boring, and honest about what a grep can know.

import { expandTemplatePath } from "../../core/lib/template-paths.mjs";
import { lex } from "../js/source.mjs";

const posixify = (p) => p.split(/[\\/]/).join("/");

// JS and TS alike (CR-095): a JavaScript App Router repo has the same
// `.from()` / `fetch('/api/…')` shapes in .js/.jsx files. A config that
// names its own `refs.extensions` keeps exactly those.
export const DEFAULT_REFS = {
  roots: null, // filled from srcAliasRoot by the caller
  extensions: [".ts", ".tsx", ".js", ".jsx"],
  excludeDirs: ["node_modules"],
  excludeSuffixes: [".test.ts", ".test.tsx", ".test.js", ".test.jsx", ".d.ts"],
};

// Default-deny walk: only configured extensions, minus excluded dirs/suffixes.
// Test files are excluded on purpose — integration tests reference tables
// wholesale for setup/assertions; those edges describe the harness, not
// production data flow. A missing root is reported, never fatal (CR-002);
// every listing goes through io (decision 0040): a symlink is skipped with
// a note, never followed, and a gitignored path is never seen (pick 1).
export function walkSourceFiles(io, { roots, extensions, excludeDirs, excludeSuffixes }, diagnostics = []) {
  const out = new Set();
  for (const root of roots) {
    const walked = io.walk(
      root,
      (rel, name) => {
        if (extensions.some((e) => name.endsWith(e)) && !excludeSuffixes.some((s) => name.endsWith(s))) out.add(rel);
      },
      { enter: (rel, name) => name !== ".git" && !excludeDirs.some((d) => rel === d || rel.endsWith(`/${d}`) || name === d) },
    );
    if (!walked.exists && !walked.skipped.length) diagnostics.push(`refs root ${root} not found — nothing to scan`);
    for (const k of walked.skipped) diagnostics.push(`${k.path}: ${k.reason} — skipped`);
    if (walked.truncated) diagnostics.push(`refs root ${root}: the walk hit its entry or depth limit — some files were not read`);
  }
  return [...out];
}

// `${expr}` -> * so template-literal URLs can match route patterns. Query
// strings and trailing slashes are noise for identity purposes.
export function normalizeFetchUrl(raw) {
  let url = raw.split("?")[0].replace(/\$\{[^}]*\}/g, "*");
  if (url.length > 1 && url.endsWith("/")) url = url.slice(0, -1);
  return url;
}

// Scan one file's text for the API calls it makes. Returns raw candidate
// urls; the deriver resolves them against every extractor's records after
// the merge. Its data access (`.from`, `.rpc`, Realtime) is a data-access
// adapter's to read (decision 0037): the file is named by `?code:<file>#*`.
export function scanFileText(text) {
  const fetchUrls = new Set();
  // Comments blanked, strings kept: a commented-out call is not a call (the
  // standard suite, decision 0040). A `${hole}` typed as a union of literals
  // in this file expands to one url per literal; any other hole is `*`, a
  // route parameter only (decision 0019).
  const code = lex(text).code;
  for (const m of code.matchAll(/\bfetch\(\s*(['"`])(\/api\/[^'"`]*)\1/g)) {
    for (const url of expandTemplatePath(m[2], code)) fetchUrls.add(normalizeFetchUrl(url));
  }
  return { fetchUrls };
}

export function scanFiles(io, files, diagnostics = []) {
  const results = new Map();
  for (const rel of files) {
    const got = io.read(rel);
    if (!got.ok) {
      diagnostics.push(got.reason);
      continue;
    }
    results.set(rel, scanFileText(got.text));
  }
  return results;
}
