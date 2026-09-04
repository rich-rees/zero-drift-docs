// nextjs extractor — routes (app-router route.ts), surfaces (page.tsx +
// layout.tsx) and modules (any other scanned file that references something)
// from a Next.js App Router tree. One convention: the App Router file layout.
// Options (extractorOptions.nextjs):
//   appDir          repo-relative app-router root (default "src/app")
//   apiPrefix       URL prefix under which route.ts files are API routes
//   middlewarePath  middleware.ts whose `config.matcher` decides session auth
//   authPatterns    [{ includes, auth }] in-file markers for other auth kinds
//   refs            { roots, extensions, excludeDirs, excludeSuffixes } — the
//                   source files scanned for outbound references
//   srcAliasRoot    where the tsconfig `@/` alias points (default: appDir's
//                   parent)
// Outbound refs (`.from('x')`, `.rpc('x')`, `fetch('/api/..')`) are emitted
// UNRESOLVED (`?from:x`, `?function:x`, `?route:/api/..`) — the tables and
// functions belong to the supabase extractor, and the deriver resolves them
// after the merge (src/lib/resolve-refs.mjs). A missing appDir or middleware
// file is "nothing to inventory" (greenfield), never an error.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { walkSourceFiles, scanFiles, DEFAULT_REFS } from "./refs.mjs";
import { slugify } from "../../lib/slug.mjs";
import { repoRelative } from "../../lib/paths.mjs";
import { walkDir } from "../../lib/walk.mjs";

export { slugify };

const posixify = (p) => p.split(/[\\/]/).join("/");

const HTTP_METHOD_ORDER = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

export const FACTS_KEY_ORDER = {
  route: ["methods", "dynamicSegments", "auth"],
  surface: ["file", "routeGroups", "dynamicSegments"],
  module: [],
};

// ---------------------------------------------------------------------------
// Route & surface walkers
// ---------------------------------------------------------------------------

function walkTree(dir, repoRoot, diagnostics, out = []) {
  walkDir(
    dir,
    (p) => out.push(p),
    new Set(),
    () => true,
    (p, reason) => diagnostics.push(`${posixify(p.slice(repoRoot.length + 1))}: ${reason} — skipped`),
  );
  return out;
}

const stripGroups = (segs) => segs.filter((s) => !/^\(.+\)$/.test(s));
const dynamicSegments = (segs) =>
  segs
    .filter((s) => /^\[.+\]$/.test(s))
    .map((s) => s.replace(/^\[\.\.\.|^\[|\]$/g, ""));

// First leading `//` comment line that is not a file-path echo (repo
// convention puts `// src/app/api/.../route.ts` on line 1, prose on line 2).
// That prose line is a code comment — store #3 — doing double duty as the
// derived description.
export function leadingComment(text) {
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("//")) break;
    const c = t.replace(/^\/\/\s?/, "").trim();
    if (!c || /(^|\s)[\w./\[\]-]*\/(route|page|layout)\.tsx?$/.test(c)) continue;
    return c;
  }
  return "";
}

// A page.tsx whose default export does nothing but render one `@/`-imported
// component is a wrapper — the GitHub link a reader wants is the component,
// not the three-line shell (DIO-181). Returns the wrapper's import source
// (e.g. "@/components/settings/ClientsPage") or null. "Bare" is strict on
// purpose: a single attribute-free `<Comp />` return, optionally inside one
// styling-only DOM element (`<div className="h-full">`); props on the
// component or any second child means real logic lives here and the page
// stays its own primary resource. The body capture is greedy to the file's
// last brace, so trailing exports after the function also disqualify —
// deliberately failing toward the page file.
export function resolveWrapperTarget(text) {
  const imports = new Map(); // local name -> import source
  for (const m of text.matchAll(/import\s+([A-Za-z_]\w*)\s+from\s*(['"])([^'"]+)\2/g)) {
    imports.set(m[1], m[3]);
  }
  for (const m of text.matchAll(/import\s*\{([^}]*)\}\s*from\s*(['"])([^'"]+)\2/g)) {
    for (const part of m[1].split(",")) {
      const seg = part.trim();
      if (!seg) continue;
      const aliased = /^([A-Za-z_]\w*)\s+as\s+([A-Za-z_]\w*)$/.exec(seg);
      imports.set(aliased ? aliased[2] : seg, m[3]);
    }
  }
  const fn = /export\s+default\s+(?:async\s+)?function\s*\w*\s*\([^)]*\)\s*\{([\s\S]*)\}/.exec(text);
  if (!fn) return null;
  const ret =
    /^\s*return\s*\(?\s*(?:<([a-z][\w-]*)(?:\s[^>]*)?>\s*)?<([A-Z]\w*)\s*\/>\s*(?:<\/\1>\s*)?\)?\s*;?\s*$/.exec(
      fn[1],
    );
  if (!ret) return null;
  const source = imports.get(ret[2]);
  return source && source.startsWith("@/") ? source : null;
}

export function extractMethods(text) {
  const found = new Set();
  for (const m of text.matchAll(/export\s+async\s+function\s+([A-Z]+)\b/g)) found.add(m[1]);
  for (const m of text.matchAll(/export\s+const\s+([A-Z]+)\s*=/g)) found.add(m[1]);
  // `export const { GET, POST } = handlers` / `export { x as GET }`
  for (const m of text.matchAll(/export\s+(?:const\s+)?\{([^}]*)\}/g)) {
    for (const part of m[1].split(",")) {
      const name = (/\bas\s+([A-Z]+)\s*$/.exec(part) ?? [, part.trim()])[1];
      if (name) found.add(name.trim());
    }
  }
  return HTTP_METHOD_ORDER.filter((m) => found.has(m));
}

// ---------------------------------------------------------------------------
// Auth derivation (facts.auth) — no hand-maintained list, per ADR-0018.
// The middleware matcher is evaluated against each route URL; matcher-excluded
// routes fall through to in-file pattern detection from config.
// ---------------------------------------------------------------------------

function loadMiddlewareMatchers(repoRoot, middlewarePath) {
  const text = readFileSync(join(repoRoot, middlewarePath), "utf8");
  const start = /matcher\s*:\s*\[/.exec(text);
  if (!start) throw new Error(`No config.matcher found in ${middlewarePath}`);
  // Scan to the matching `]` respecting string literals — the matcher patterns
  // themselves contain `]` (e.g. `[^/]+`), so a lazy regex would truncate.
  let i = start.index + start[0].length;
  let depth = 1;
  let quote = null;
  let block = "";
  for (; i < text.length && depth > 0; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === "\\") {
        block += ch + text[i + 1];
        i++;
        continue;
      }
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if (ch === "[") depth++;
    else if (ch === "]") depth--;
    if (depth > 0) block += ch;
  }
  const patterns = [...block.matchAll(/(["'`])((?:\\.|(?!\1).)*)\1/g)].map((m) => m[2]);
  // These matchers are regex-flavoured (single group with a lookahead), which
  // maps 1:1 onto a RegExp. Anchor both ends, as Next does.
  return patterns.map((p) => new RegExp(`^${p}$`));
}

function deriveAuth(urlPath, routeText, matchers, authPatterns, apiPrefix) {
  if (matchers.some((re) => re.test(urlPath))) return "session";
  // NextAuth's own endpoints ARE the auth mechanism, not consumers of it.
  if (urlPath.startsWith(`${apiPrefix}/auth/`) || urlPath === `${apiPrefix}/auth`) return "is-auth";
  for (const { includes, auth } of authPatterns) {
    if (routeText.includes(includes)) return auth;
  }
  if (/\bauth\(\)/.test(routeText)) return "session-in-handler";
  return "public";
}

// ---------------------------------------------------------------------------
// derive(ctx) — the extractor contract
// ---------------------------------------------------------------------------

export function derive({ repoRoot, options }) {
  const diagnostics = [];
  const {
    appDir: appDirOpt = "src/app",
    apiPrefix = "/api",
    middlewarePath: middlewareOpt,
    authPatterns = [],
    // Where the tsconfig `@/` path alias points, repo-relative. Default: the
    // Next.js convention of appDir's parent (`src/app` -> `src`).
    srcAliasRoot: srcAliasOpt,
    refs: refsOpt = {},
  } = options;
  // Every path option stays inside the repo (CR-005); a partial `refs` object
  // is completed field by field, not replaced wholesale (CR-017).
  const appDir = repoRelative(appDirOpt, "nextjs.appDir");
  const middlewarePath = middlewareOpt ? repoRelative(middlewareOpt, "nextjs.middlewarePath") : undefined;
  const srcAliasRoot = repoRelative(srcAliasOpt ?? appDir.replace(/\/app$/, ""), "nextjs.srcAliasRoot");
  if (typeof refsOpt !== "object" || Array.isArray(refsOpt)) throw new Error(`nextjs: 'refs' must be an object`);
  if (!Array.isArray(authPatterns)) throw new Error(`nextjs: 'authPatterns' must be an array`);
  // An entry without `auth` derived `auth: undefined`, which the serializer
  // wrote as invalid JSON (CR-093). Shape-check every entry up front.
  authPatterns.forEach((p, i) => {
    if (!p || typeof p !== "object" || Array.isArray(p) || typeof p.includes !== "string" || typeof p.auth !== "string") {
      throw new Error(`nextjs: 'authPatterns[${i}]' must be { includes: string, auth: string }, got ${JSON.stringify(p)}`);
    }
  });
  const refsOptions = { ...DEFAULT_REFS, roots: [srcAliasRoot], ...refsOpt };
  for (const k of ["roots", "extensions", "excludeDirs", "excludeSuffixes"]) {
    if (!Array.isArray(refsOptions[k])) throw new Error(`nextjs: 'refs.${k}' must be an array`);
  }
  refsOptions.roots = refsOptions.roots.map((r) => repoRelative(r, "nextjs.refs.roots"));

  // ---- Route & surface trees ----
  const appAbs = join(repoRoot, appDir);
  if (!existsSync(appAbs)) diagnostics.push(`${appDir} not found — nothing to inventory`);
  const appFiles = walkTree(appAbs, repoRoot, diagnostics).map((p) => posixify(p.slice(repoRoot.length + 1)));
  const apiDirRel = posixify(join(appDir, apiPrefix.replace(/^\//, "")));

  const routes = [];
  const surfaces = [];
  for (const rel of appFiles) {
    const inApp = rel.slice(appDir.length + 1);
    const segs = inApp.split("/");
    const base = segs.pop();
    if (rel.startsWith(apiDirRel + "/") && base === "route.ts") {
      const urlPath = "/" + stripGroups(segs).join("/");
      routes.push({ rel, dir: segs.join("/"), urlPath, segs });
    } else if (!rel.startsWith(apiDirRel + "/") && (base === "page.tsx" || base === "layout.tsx")) {
      surfaces.push({ rel, dir: segs.join("/"), segs, file: base === "page.tsx" ? "page" : "layout" });
    }
  }

  // ---- Refs scan ----
  const sourceFiles = walkSourceFiles(repoRoot, refsOptions, diagnostics);
  const scans = scanFiles(repoRoot, sourceFiles);

  // Attribution: nearest enclosing route dir wins; else nearest page (then
  // layout) dir; else the file becomes its own module record.
  const routeDirs = new Map(routes.map((r) => [posixify(join(appDir, r.dir)), r]));
  const pageDirs = new Map();
  const layoutDirs = new Map();
  for (const s of surfaces) {
    const key = posixify(join(appDir, s.dir));
    if (s.file === "page") pageDirs.set(key, s);
    else layoutDirs.set(key, s);
  }
  const nearest = (rel, dirMap) => {
    let dir = rel.slice(0, rel.lastIndexOf("/"));
    while (dir.length >= appDir.length) {
      if (dirMap.has(dir)) return dirMap.get(dir);
      const cut = dir.lastIndexOf("/");
      if (cut === -1) break;
      dir = dir.slice(0, cut);
    }
    return null;
  };

  // One file's scan -> unresolved ref strings; the deriver resolves them
  // against every extractor's records after the merge.
  const unresolvedRefs = (rel, scan) => {
    const refs = new Set();
    for (const name of scan.fromNames) refs.add(`?from:${name}`);
    for (const name of scan.rpcNames) refs.add(`?function:${name}`);
    for (const url of scan.fetchUrls) refs.add(`?route:${url}`);
    for (const ident of scan.unresolvedFromIdents) {
      diagnostics.push(`${rel}: .from(${ident}) — identifier not resolvable file-locally`);
    }
    return refs;
  };

  const routeRefs = new Map(); // route rel -> Set
  const surfaceRefs = new Map(); // surface rel -> Set
  const moduleFiles = []; // { rel, refs }
  for (const [rel, scan] of scans) {
    const refs = unresolvedRefs(rel, scan);
    const route = rel.startsWith(apiDirRel + "/") ? nearest(rel, routeDirs) : null;
    if (route) {
      const set = routeRefs.get(route.rel) ?? new Set();
      refs.forEach((r) => set.add(r));
      routeRefs.set(route.rel, set);
      continue;
    }
    const surface = rel.startsWith(appDir + "/") ? (nearest(rel, pageDirs) ?? nearest(rel, layoutDirs)) : null;
    if (surface) {
      const set = surfaceRefs.get(surface.rel) ?? new Set();
      refs.forEach((r) => set.add(r));
      surfaceRefs.set(surface.rel, set);
      continue;
    }
    if (refs.size) moduleFiles.push({ rel, refs });
  }

  // ---- Assemble records ----
  const records = [];
  let matchers = [];
  if (middlewarePath) {
    if (existsSync(join(repoRoot, middlewarePath))) matchers = loadMiddlewareMatchers(repoRoot, middlewarePath);
    else diagnostics.push(`${middlewarePath} not found — no middleware auth derived`);
  }

  for (const r of routes) {
    const text = readFileSync(join(repoRoot, r.rel), "utf8");
    records.push({
      kind: "route",
      id: `route:${r.urlPath}`,
      title: r.urlPath,
      description: leadingComment(text),
      resource: [r.rel],
      refs: [...(routeRefs.get(r.rel) ?? [])],
      facts: {
        methods: extractMethods(text),
        dynamicSegments: dynamicSegments(r.segs),
        auth: deriveAuth(r.urlPath, text, matchers, authPatterns, apiPrefix),
      },
      filename: `${slugify(r.urlPath.slice(apiPrefix.length + 1) || "index")}.json`,
    });
  }

  for (const s of surfaces) {
    const text = readFileSync(join(repoRoot, s.rel), "utf8");
    // Pages strip route groups (they are URLs); layouts keep them (they are
    // file-tree entities — stripping would collide (app)/layout with the root
    // layout) and gain a `/_layout` pseudo-segment, collision-free because
    // Next.js ignores `_`-prefixed segments in real URLs.
    const urlPath =
      s.file === "page"
        ? "/" + stripGroups(s.segs).join("/")
        : "/" + [...s.segs, "_layout"].join("/");
    // resource[0] is what the human index's GitHub link opens — for wrapper
    // pages that must be the rendered component; the page file stays in the
    // list as routing truth (DIO-181).
    const resource = [s.rel];
    if (s.file === "page") {
      const target = resolveWrapperTarget(text);
      if (target) {
        // `@/` maps to srcAliasRoot (tsconfig paths; configurable because not
        // every repo aliases to appDir's parent).
        const base = posixify(join(srcAliasRoot, target.slice(2)));
        const hit = [".tsx", ".ts", "/index.tsx", "/index.ts"]
          .map((ext) => base + ext)
          .find((p) => existsSync(join(repoRoot, p)));
        if (hit) resource.unshift(hit);
        else diagnostics.push(`${s.rel}: wrapper import '${target}' resolves to no file — page kept as primary resource`);
      }
    }
    records.push({
      kind: "surface",
      id: `surface:${urlPath === "//" ? "/" : urlPath}`,
      title: urlPath === "//" ? "/" : urlPath,
      description: leadingComment(text),
      resource,
      refs: [...(surfaceRefs.get(s.rel) ?? [])],
      facts: {
        file: s.file,
        routeGroups: s.segs.filter((x) => /^\(.+\)$/.test(x)),
        dynamicSegments: dynamicSegments(s.segs),
      },
      filename: `${slugify(urlPath)}.json`,
    });
  }

  // A module record exists only for a file that references something that
  // resolves — `requireRefs` asks the deriver to drop it otherwise.
  for (const { rel, refs } of moduleFiles.sort((a, b) => (a.rel < b.rel ? -1 : 1))) {
    const text = readFileSync(join(repoRoot, rel), "utf8");
    records.push({
      kind: "module",
      id: `module:${rel}`,
      title: rel,
      description: leadingComment(text),
      resource: [rel],
      refs: [...refs],
      facts: {},
      filename: `${slugify(rel)}.json`,
      requireRefs: true,
    });
  }

  return { records, diagnostics };
}
