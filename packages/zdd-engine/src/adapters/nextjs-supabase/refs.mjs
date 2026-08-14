// Static reference scanner for the nextjs-supabase ZDD adapter.
//
// Finds outbound references in TS/TSX source: Supabase table/bucket access
// (`.from('name')`), RPC calls (`.rpc('name')`) and internal API calls
// (`fetch('/api/...')`). Purely textual — no import-graph resolution, no
// type-checking. Wrapper libs (journey-api.ts etc.) keep their refs on their
// own module record rather than propagating to callers: mechanically true,
// boring, and honest about what a grep can know.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const posixify = (p) => p.split(/[\\/]/).join("/");

// Default-deny walk: only configured extensions, minus excluded dirs/suffixes.
// Test files are excluded on purpose — integration tests reference tables
// wholesale for setup/assertions; those edges describe the harness, not
// production data flow.
export function walkSourceFiles(repoRoot, { roots, extensions, excludeDirs, excludeSuffixes }) {
  const out = [];
  const visit = (dir) => {
    let names;
    try {
      names = readdirSync(dir).sort();
    } catch {
      return;
    }
    for (const name of names) {
      const p = join(dir, name);
      const rel = posixify(p.slice(repoRoot.length + 1));
      const st = statSync(p);
      if (st.isDirectory()) {
        if (!excludeDirs.some((d) => rel === d || rel.endsWith(`/${d}`) || name === d)) visit(p);
      } else if (
        extensions.some((e) => name.endsWith(e)) &&
        !excludeSuffixes.some((s) => name.endsWith(s))
      ) {
        out.push(rel);
      }
    }
  };
  for (const root of roots) visit(join(repoRoot, root));
  return out;
}

// `${expr}` -> * so template-literal URLs can match route patterns. Query
// strings and trailing slashes are noise for identity purposes.
export function normalizeFetchUrl(raw) {
  let url = raw.split("?")[0].replace(/\$\{[^}]*\}/g, "*");
  if (url.length > 1 && url.endsWith("/")) url = url.slice(0, -1);
  return url;
}

// Scan one file's text. Returns raw candidate names; the caller resolves them
// against known table/bucket/function sets (name-set membership is the whole
// disambiguation strategy — receivers vary too much to be a signal).
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

// Build a matcher for a route URL: `[x]` eats one segment, `[...x]` eats one
// or more trailing segments. Fetch-side `${expr}` was normalized to `*`,
// which also eats exactly one segment.
export function makeRouteMatcher(routePath) {
  const segs = routePath.split("/").filter(Boolean);
  return (url) => {
    const uSegs = url.split("/").filter(Boolean);
    let i = 0;
    for (; i < segs.length; i++) {
      const s = segs[i];
      if (/^\[\.\.\..+\]$/.test(s)) return uSegs.length - i >= 1; // catch-all: 1+ trailing
      if (uSegs.length <= i) return false;
      if (/^\[.+\]$/.test(s)) continue; // dynamic: any single segment (incl. *)
      if (s !== uSegs[i] && uSegs[i] !== "*") return false;
    }
    return uSegs.length === segs.length;
  };
}

export function scanFiles(repoRoot, files) {
  const results = new Map();
  for (const rel of files) {
    const text = readFileSync(join(repoRoot, rel), "utf8");
    results.set(rel, scanFileText(text));
  }
  return results;
}
