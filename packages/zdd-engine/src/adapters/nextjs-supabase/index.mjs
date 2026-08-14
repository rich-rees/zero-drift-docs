// nextjs-supabase adapter for the ZDD deriver (adapter #1, the proving
// implementation). Stack-specific by design — Next.js App Router + Supabase
// migration conventions live here; project-specific facts live in the
// adopter's zdd/config.json adapterOptions.
//
// Emits derived records for: routes (app-router route.ts), surfaces (page.tsx
// + layout.tsx), tables/functions/buckets (migration replay), and modules
// (any other scanned file with ≥1 resolved ref). Everything here must be
// mechanically extractable — anything needing judgment belongs in the
// semantic layer.

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { replayMigrations, sortMigrations } from "./sql-replay.mjs";
import { walkSourceFiles, scanFiles, makeRouteMatcher } from "./refs.mjs";

const posixify = (p) => p.split(/[\\/]/).join("/");

const HTTP_METHOD_ORDER = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

// Canonical facts key order per kind (consumed by the standard tier's
// serializer so output is byte-stable).
export const FACTS_KEY_ORDER = {
  route: ["methods", "dynamicSegments", "auth"],
  surface: ["file", "routeGroups", "dynamicSegments"],
  table: ["namespace", "columns", "createdIn", "renamedFrom"],
  function: ["namespace", "signature", "returns", "language", "triggers"],
  bucket: ["namespace", "origin", "public", "fileSizeLimit", "allowedMimeTypes"],
  module: [],
};

// ---------------------------------------------------------------------------
// Slugs & ids
// ---------------------------------------------------------------------------

// URL-ish path -> filename slug: `/`->`--`, `[p]`->`_p`, `[...p]`->`___p`.
// Route-group parens are kept where the caller left them in the path (layout
// ids keep groups precisely so the two roots can't collide).
export function slugify(path) {
  const cleaned = path.replace(/^\/+/, "");
  if (!cleaned) return "index";
  return cleaned
    .split("/")
    .map((seg) =>
      seg
        .replace(/^\[\.\.\.(.+)\]$/, "___$1")
        .replace(/^\[(.+)\]$/, "_$1")
        .replace(/\./g, "-"),
    )
    .join("--");
}

// ---------------------------------------------------------------------------
// Route & surface walkers
// ---------------------------------------------------------------------------

function walkTree(dir, out = []) {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walkTree(p, out);
    else out.push(p);
  }
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
// derive(ctx) — the adapter contract
// ---------------------------------------------------------------------------

export function derive({ repoRoot, options }) {
  const diagnostics = [];
  const {
    appDir,
    apiPrefix = "/api",
    migrationNamespaces,
    externalBuckets = [],
    refs: refsOptions,
    middlewarePath,
    authPatterns = [],
    // Where the tsconfig `@/` path alias points, repo-relative. Default: the
    // Next.js convention of appDir's parent (`src/app` -> `src`).
    srcAliasRoot = appDir.replace(/\/app$/, ""),
  } = options;

  // ---- Schema replay (per namespace, independent) ----
  const schemas = new Map(); // ns -> { tables, functions, buckets }
  for (const { name: ns, dir } of migrationNamespaces) {
    const abs = join(repoRoot, dir);
    // Non-recursive on purpose: media/ nests inside the env dir but is a
    // separate database.
    const files = sortMigrations(
      readdirSync(abs).filter((f) => f.endsWith(".sql") && statSync(join(abs, f)).isFile()),
    ).map((f) => ({ name: `${dir}/${f}`, text: readFileSync(join(abs, f), "utf8") }));
    const replayed = replayMigrations(files);
    for (const s of replayed.skipped) {
      diagnostics.push(`[sql-replay:${ns}] unrecognized schema-like statement in ${s.file}: ${s.statement}`);
    }
    schemas.set(ns, replayed);
  }

  // Name -> namespace lookups. A name in two namespaces (or in both a table
  // set and a bucket set) would make `.from('name')` unattributable —
  // hard-error rather than guess.
  const tableNs = new Map();
  const functionNs = new Map();
  const bucketNs = new Map();
  for (const [ns, { tables, functions, buckets }] of schemas) {
    for (const name of tables.keys()) {
      if (tableNs.has(name)) throw new Error(`Table '${name}' exists in namespaces '${tableNs.get(name)}' and '${ns}' — cannot attribute .from() calls`);
      tableNs.set(name, ns);
    }
    for (const name of functions.keys()) {
      if (!functionNs.has(name)) functionNs.set(name, ns);
    }
    for (const name of buckets.keys()) bucketNs.set(name, ns);
  }
  for (const { name, namespace } of externalBuckets) bucketNs.set(name, namespace);
  for (const [name] of bucketNs) {
    if (tableNs.has(name)) throw new Error(`Name '${name}' is both a table and a bucket — add config disambiguation`);
  }

  // ---- Route & surface trees ----
  const appAbs = join(repoRoot, appDir);
  const appFiles = walkTree(appAbs).map((p) => posixify(p.slice(repoRoot.length + 1)));
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
  const sourceFiles = walkSourceFiles(repoRoot, refsOptions);
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

  const routeMatchers = routes.map((r) => ({ route: r, match: makeRouteMatcher(r.urlPath) }));

  // Resolve one file's scan into ref-id strings.
  const resolveRefs = (rel, scan) => {
    const refs = new Set();
    for (const name of scan.fromNames) {
      if (tableNs.has(name)) refs.add(`table:${tableNs.get(name)}/${name}`);
      else if (bucketNs.has(name)) refs.add(`bucket:${bucketNs.get(name)}/${name}`);
      else diagnostics.push(`[refs] ${rel}: .from('${name}') matches no known table or bucket — dropped`);
    }
    for (const name of scan.rpcNames) {
      if (functionNs.has(name)) refs.add(`function:${functionNs.get(name)}/${name}`);
      else diagnostics.push(`[refs] ${rel}: .rpc('${name}') matches no known function — dropped`);
    }
    for (const url of scan.fetchUrls) {
      const hit = routeMatchers.find((rm) => rm.match(url));
      if (hit) refs.add(`route:${hit.route.urlPath}`);
      else diagnostics.push(`[refs] ${rel}: fetch('${url}') matches no route — dropped`);
    }
    for (const ident of scan.unresolvedFromIdents) {
      diagnostics.push(`[refs] ${rel}: .from(${ident}) — identifier not resolvable file-locally`);
    }
    return refs;
  };

  const routeRefs = new Map(); // route rel -> Set
  const surfaceRefs = new Map(); // surface rel -> Set
  const moduleFiles = []; // { rel, refs }
  for (const [rel, scan] of scans) {
    const refs = resolveRefs(rel, scan);
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
  const matchers = middlewarePath ? loadMiddlewareMatchers(repoRoot, middlewarePath) : [];

  for (const r of routes) {
    const text = readFileSync(join(repoRoot, r.rel), "utf8");
    const refs = routeRefs.get(r.rel) ?? new Set();
    // A route's own refs may include a self-fetch via a colocated helper;
    // drop self-references.
    refs.delete(`route:${r.urlPath}`);
    records.push({
      kind: "route",
      id: `route:${r.urlPath}`,
      title: r.urlPath,
      description: leadingComment(text),
      resource: [r.rel],
      refs: [...refs].sort(),
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
    const refs = surfaceRefs.get(s.rel) ?? new Set();
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
        else diagnostics.push(`[wrapper] ${s.rel}: wrapper import '${target}' resolves to no file — page kept as primary resource`);
      }
    }
    records.push({
      kind: "surface",
      id: `surface:${urlPath === "//" ? "/" : urlPath}`,
      title: urlPath === "//" ? "/" : urlPath,
      description: leadingComment(text),
      resource,
      refs: [...refs].sort(),
      facts: {
        file: s.file,
        routeGroups: s.segs.filter((x) => /^\(.+\)$/.test(x)),
        dynamicSegments: dynamicSegments(s.segs),
      },
      filename: `${slugify(urlPath)}.json`,
    });
  }

  for (const [ns, { tables, functions, buckets, triggers }] of schemas) {
    for (const name of [...tables.keys()].sort()) {
      const t = tables.get(name);
      const refs = new Set();
      for (const col of t.columns) {
        if (col.references) {
          const target = col.references.split("(")[0];
          if (tableNs.get(target) === ns && target !== name) refs.add(`table:${ns}/${target}`);
        }
      }
      const facts = { namespace: ns, columns: t.columns, createdIn: t.createdIn.split("/").pop() };
      if (t.renamedFrom.length) facts.renamedFrom = t.renamedFrom;
      records.push({
        kind: "table",
        id: `table:${ns}/${name}`,
        title: `${name} (${ns})`,
        description: t.description,
        resource: t.resources,
        refs: [...refs].sort(),
        facts,
        filename: `${ns}--${name}.json`,
      });
    }
    for (const name of [...functions.keys()].sort()) {
      const f = functions.get(name);
      // Function -> table edges: known table names appearing as whole words in
      // the (last) definition body. Textual, therefore honest. Trigger
      // functions never name their tables (`NEW.updated_at = now()`), so
      // CREATE TRIGGER attachments contribute edges + facts.triggers too.
      const refs = new Set();
      for (const [tName, tNs] of tableNs) {
        if (tNs === ns && new RegExp(`\\b${tName}\\b`).test(f.body)) refs.add(`table:${ns}/${tName}`);
      }
      const attached = triggers.filter((t) => t.fn === name && tables.has(t.table));
      const facts = { namespace: ns, signature: f.signature, returns: f.returns, language: f.language };
      if (attached.length) {
        for (const t of attached) refs.add(`table:${ns}/${t.table}`);
        facts.triggers = attached
          .map((t) => `${(t.timing + " " + t.events.join(" or ")).toUpperCase()} ON ${t.table}`)
          .sort();
      }
      records.push({
        kind: "function",
        id: `function:${ns}/${name}`,
        title: `${name}()`,
        description: f.description,
        resource: f.resources,
        refs: [...refs].sort(),
        facts,
        filename: `${ns}--${name}.json`,
      });
    }
    for (const name of [...buckets.keys()].sort()) {
      const b = buckets.get(name);
      records.push({
        kind: "bucket",
        id: `bucket:${ns}/${name}`,
        title: `${name} (${ns})`,
        description: b.description,
        resource: b.resource,
        refs: [],
        facts: { namespace: ns, origin: "migration", ...b.facts },
        filename: `${ns}--${name}.json`,
      });
    }
  }

  for (const { name, namespace } of [...externalBuckets].sort((a, b) => (a.name < b.name ? -1 : 1))) {
    records.push({
      kind: "bucket",
      id: `bucket:${namespace}/${name}`,
      title: `${name} (${namespace})`,
      description: "",
      resource: [],
      refs: [],
      facts: { namespace, origin: "external" },
      filename: `${namespace}--${name}.json`,
    });
  }

  for (const { rel, refs } of moduleFiles.sort((a, b) => (a.rel < b.rel ? -1 : 1))) {
    const text = readFileSync(join(repoRoot, rel), "utf8");
    records.push({
      kind: "module",
      id: `module:${rel}`,
      title: rel,
      description: leadingComment(text),
      resource: [rel],
      refs: [...refs].sort(),
      facts: {},
      filename: `${slugify(rel)}.json`,
    });
  }

  return { records, diagnostics };
}
