// Static reference scanner for the nextjs ZDD extractor.
//
// Finds outbound references in TS/TSX source: Supabase table/bucket access
// (`.from('name')`), RPC calls (`.rpc('name')`) and internal API calls
// (`fetch('/api/...')`). Purely textual — no import-graph resolution, no
// type-checking. Wrapper libs (journey-api.ts etc.) keep their refs on their
// own module record rather than propagating to callers: mechanically true,
// boring, and honest about what a grep can know.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { walkDir } from "../../lib/walk.mjs";

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
export function walkSourceFiles(repoRoot, { roots, extensions, excludeDirs, excludeSuffixes }, diagnostics = []) {
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
        if (extensions.some((e) => name.endsWith(e)) && !excludeSuffixes.some((s) => name.endsWith(s))) {
          out.push(posixify(p.slice(repoRoot.length + 1)));
        }
      },
      seen,
      (p, name) => {
        const rel = posixify(p.slice(repoRoot.length + 1));
        return !excludeDirs.some((d) => rel === d || rel.endsWith(`/${d}`) || name === d);
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

// Scan one file's text. Returns raw candidate names; the deriver resolves them
// against every extractor's records after the merge (name-set membership is
// the whole disambiguation strategy — receivers vary too much to be a signal).
export function scanFileText(text) {
  const fromNames = new Set();
  const rpcNames = new Set();
  const fetchUrls = new Set();
  const unresolvedFromIdents = new Set();

  // File-local `const NAME = 'literal'` bindings — covers the repo's bucket
  // constants (BUCKET, SURVEY_MEDIA_BUCKET, MEDIA_HLS_BUCKET). Cross-file
  // constants are an accepted gap, surfaced via diagnostics.
  const consts = new Map();
  for (const m of text.matchAll(/\bconst\s+([A-Za-z_]\w*)\s*=\s*(['"])([^'"]+)\2/g)) {
    consts.set(m[1], m[3]);
  }

  for (const m of text.matchAll(/\.from\(\s*(['"])([\w-]+)\1\s*\)/g)) fromNames.add(m[2]);
  for (const m of text.matchAll(/\.from\(\s*([A-Za-z_]\w*)\s*\)/g)) {
    const resolved = consts.get(m[1]);
    if (resolved) fromNames.add(resolved);
    else unresolvedFromIdents.add(m[1]);
  }
  for (const m of text.matchAll(/\.rpc\(\s*(['"])(\w+)\1/g)) rpcNames.add(m[2]);
  for (const m of text.matchAll(/\bfetch\(\s*(['"`])(\/api\/[^'"`]*)\1/g)) {
    fetchUrls.add(normalizeFetchUrl(m[2]));
  }

  return { fromNames, rpcNames, fetchUrls, unresolvedFromIdents };
}

export function scanFiles(repoRoot, files) {
  const results = new Map();
  for (const rel of files) {
    const text = readFileSync(join(repoRoot, rel), "utf8");
    results.set(rel, scanFileText(text));
  }
  return results;
}
