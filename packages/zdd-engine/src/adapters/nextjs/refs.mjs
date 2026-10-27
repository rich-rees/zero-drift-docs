// Static reference scanner for the nextjs ZDD extractor.
//
// Finds outbound references in TS/TSX source: internal API calls
// (`fetch('/api/...')`). Data access moved to supabase-js in 0.9 (decision
// 0037). Purely textual — no import-graph resolution, no
// type-checking. Wrapper libs (journey-api.ts etc.) keep their refs on their
// own module record rather than propagating to callers: mechanically true,
// boring, and honest about what a grep can know.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { walkDir } from "../../core/lib/walk.mjs";
import { expandTemplatePath } from "../../core/lib/template-paths.mjs";

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
// symlink cycles are cut by the shared walker (CR-016).
// `isIgnored`: a gitignored path is never source (2.3.0, pick 1).
export function walkSourceFiles(repoRoot, { roots, extensions, excludeDirs, excludeSuffixes }, diagnostics = [], isIgnored = () => false) {
  const out = [];
  const seen = new Set();
  for (const root of roots) {
    const abs = join(repoRoot, root);
    if (!existsSync(abs)) {
      diagnostics.push(`refs root ${root} not found — nothing to scan`);
      continue;
    }
    walkDir(
      abs,
      (p, name) => {
        const rel = posixify(p.slice(repoRoot.length + 1));
        if (extensions.some((e) => name.endsWith(e)) && !excludeSuffixes.some((s) => name.endsWith(s)) && !isIgnored(rel)) {
          out.push(rel);
        }
      },
      seen,
      (p, name) => {
        const rel = posixify(p.slice(repoRoot.length + 1));
        return !excludeDirs.some((d) => rel === d || rel.endsWith(`/${d}`) || name === d) && !isIgnored(rel);
      },
      (p, reason) => diagnostics.push(`${posixify(p.slice(repoRoot.length + 1))}: ${reason} — skipped`),
    );
  }
  return out;
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
  // A `${hole}` typed as a union of literals in this file expands to one url
  // per literal; any other hole is `*`, a route parameter only (decision 0019).
  for (const m of text.matchAll(/\bfetch\(\s*(['"`])(\/api\/[^'"`]*)\1/g)) {
    for (const url of expandTemplatePath(m[2], text)) fetchUrls.add(normalizeFetchUrl(url));
  }
  return { fetchUrls };
}

export function scanFiles(repoRoot, files) {
  const results = new Map();
  for (const rel of files) {
    const text = readFileSync(join(repoRoot, rel), "utf8");
    results.set(rel, scanFileText(text));
  }
  return results;
}
