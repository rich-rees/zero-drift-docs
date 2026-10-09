// external-services extractor — the third-party systems a module depends on
// (Resend, Sentry, Salesforce, Google Places): CAS-97, ZDD 2.1, decision
// 0020; renamed from `services` in 2.3 (CAS-103 pick 3) because "services"
// read as a code service layer. The old name is an alias for one release
// (derive's registry and config.mjs route it here, passing `legacyName`),
// and under the alias the records keep the OLD kind, ids and folder
// (`service`, `service:<slug>`, metadata/service/): nothing in an adopter's
// generated artifacts moves until "upgrade ZDD" renames the config key, and
// then it moves once, listed in the upgrade notes — so the rename is a
// minor, not a metadata-contract break (slice 1 review CR-302). A service
// is DECLARED in config with the markers that reveal it; the engine ships
// no vendor list:
//   { "name": "Sentry", "imports": ["sentry_sdk", "@sentry/react"], "env": ["SENTRY_"] }
// The extractor scans source for an import of a marker package (Python
// `import x` / `from x import`, JS `import … from "x"` / `require("x")`) and
// for a read of an environment variable NAME with a marker prefix
// (`os.environ["X"]`, `os.getenv("X")`, `.get("X")`, `process.env.X`,
// `import.meta.env.X`, `Deno.env.get("X")`) — names only, never values, and
// never a `.env` file or the process environment. One record per declared
// service, kind `external-service`: its `resource` is the file that declares the
// dependency (the first import site; failing that, the first env read), so
// the panel's link opens the code that makes the node true; `facts.usedBy`
// lists every file that hit a marker, and `facts.edges.usedBy` names the
// records at those files (`?at:<file>`, resolved after the merge to every
// record whose resource list holds the file — a route, a surface, a job).
// A declared service with no hits is a diagnostic and no record.
// Limit (CAS-99, documented, not fixed): `usedBy` is the files that carry a
// marker, never the files that reach the provider through them. A module
// that reads `RESEND_API_KEY` into a settings object is a user; the sender
// that takes the key from that object (`senders.py`, `postcodes.py` on
// Cascade) is not seen, and neither are the routes that call it.
//
// Candidates: an env name read in source whose suffix says "a credential or
// an address" (`_API_KEY`, `_DSN`, `_SECRET`, `_TOKEN`, `_URL`, `_KEY`),
// grouped by prefix, that no declared service covers and no `ignore` prefix
// names, is a WARNING printed by every derive (not only --verbose), so the
// branch that added a vendor is told on that branch. Prefixes ZDD already
// knows as the database or the platform are never candidates.
// Options (extractorOptions["external-services"]):
//   services   [{ name, imports?, env? }] (at least one of imports/env)
//   ignore     env prefixes that are not services (added to the built-ins)
//   roots      dirs scanned (default ["."]); node_modules, .git, build
//              output and virtualenvs are never entered
//   extensions default [".py", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]
// Every file is read through `io` (decision 0010). Deterministic.

import { repoRelative } from "../../lib/paths.mjs";

export const FACTS_KEY_ORDER = {
  "external-service": ["markers", "usedBy", "edges"],
  service: ["markers", "usedBy", "edges"], // the pre-2.3 kind, emitted under the alias
};
export const MAX_SOURCE_BYTES = 1024 * 1024;
const DEFAULT_EXTENSIONS = [".py", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
const NEVER_ENTER = new Set([".git", "node_modules", ".venv", "venv", "dist", "build", ".next", ".expo", "coverage", "__pycache__"]);
const TEST_FILE = /\.(test|spec|stories)\.[cm]?[jt]sx?$|(^|\/)(test_[^/]*\.py|[^/]*_test\.py|conftest\.py)$|\.d\.ts$/;
export const CANDIDATE_SUFFIXES = ["_API_KEY", "_DSN", "_SECRET", "_TOKEN", "_URL", "_KEY"];
// Prefixes that are the database, the platform or the build, never a vendor.
export const BUILT_IN_IGNORE = ["DATABASE", "SUPABASE", "PG", "POSTGRES", "NODE", "NEXT", "VITE", "EXPO", "PUBLIC", "CI", "GITHUB", "RAILWAY", "VERCEL", "PORT", "HOST", "BASE", "API", "APP", "WEB", "SERVER", "CLIENT", "AUTH", "JWT", "SESSION", "COOKIE", "TEST", "DEV", "LOG"];
const PUBLIC_PREFIXES = /^(NEXT_PUBLIC_|VITE_|EXPO_PUBLIC_|REACT_APP_|PUBLIC_)/;

// Every environment variable NAME a file's text reads, in source order, deduped.
export function scanEnvReads(text) {
  const out = new Set();
  const NAME = "([A-Z][A-Z0-9_]{2,})";
  const patterns = [
    new RegExp(`\\bos\\.environ(?:\\.get)?\\s*[\\[(]\\s*['"]${NAME}['"]`, "g"),
    new RegExp(`\\bos\\.getenv\\s*\\(\\s*['"]${NAME}['"]`, "g"),
    new RegExp(`\\.get\\s*\\(\\s*['"]${NAME}['"]`, "g"),
    new RegExp(`\\bprocess\\.env(?:\\.${NAME}|\\s*\\[\\s*['"]${NAME}['"])`, "g"),
    new RegExp(`\\bimport\\.meta\\.env(?:\\.${NAME}|\\s*\\[\\s*['"]${NAME}['"])`, "g"),
    new RegExp(`\\bDeno\\.env\\.get\\s*\\(\\s*['"]${NAME}['"]`, "g"),
  ];
  for (const re of patterns) for (const m of text.matchAll(re)) out.add(m[1] ?? m[2]);
  return out;
}

// Every module a file imports, as written (Python dotted, JS specifier).
export function scanImports(text) {
  const out = new Set();
  // Python `import a, b.c` — a whole line, so JS's `import x from "y"` is not one.
  for (const m of text.matchAll(/^\s*import\s+([\w.]+(?:\s*,\s*[\w.]+)*)\s*(?:#.*)?$/gm)) for (const name of m[1].split(",")) out.add(name.trim());
  for (const m of text.matchAll(/^\s*from\s+([\w.]+)\s+import\b/gm)) out.add(m[1]);
  for (const m of text.matchAll(/\bimport\s*(?:[^'"`;]*?\bfrom\s*)?(['"])([^'"]+)\1/g)) out.add(m[2]);
  for (const m of text.matchAll(/\brequire\s*\(\s*(['"])([^'"]+)\1\s*\)/g)) out.add(m[2]);
  return out;
}

const importMatches = (spec, marker) => spec === marker || spec.startsWith(`${marker}.`) || spec.startsWith(`${marker}/`);
const envPrefixOf = (name) => name.replace(PUBLIC_PREFIXES, "").split("_")[0];
const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export function derive({ repoRoot, options, io, legacyName }) {
  void repoRoot;
  const diagnostics = [];
  const warnings = [];
  const kind = legacyName === "services" ? "service" : "external-service";
  const label = legacyName === "services" ? "services" : "external-services";
  const services = options.services ?? [];
  if (!Array.isArray(services)) throw new Error(`${label}.services must be an array`);
  const declared = services.map((s, i) => {
    if (!s || typeof s !== "object" || typeof s.name !== "string" || !s.name.trim()) throw new Error(`${label}.services[${i}] must have a name`);
    const imports = s.imports ?? [];
    const env = s.env ?? [];
    if (!Array.isArray(imports) || imports.some((x) => typeof x !== "string") || !Array.isArray(env) || env.some((x) => typeof x !== "string")) throw new Error(`${label}.services[${i}] (${s.name}): imports and env must be arrays of strings`);
    if (!imports.length && !env.length) throw new Error(`${label}.services[${i}] (${s.name}): declare at least one import or env marker`);
    return { name: s.name.trim(), imports, env: env.map((e) => e.toUpperCase()) };
  });
  const names = new Set();
  for (const s of declared) {
    if (names.has(slug(s.name))) throw new Error(`${label}.services: '${s.name}' is declared twice`);
    names.add(slug(s.name));
  }
  const ignore = new Set([...BUILT_IN_IGNORE, ...(options.ignore ?? []).map((p) => String(p).toUpperCase().replace(/_$/, ""))]);
  const roots = (options.roots ?? ["."]).map((r) => repoRelative(r, "external-services.roots"));
  const extensions = options.extensions ?? DEFAULT_EXTENSIONS;
  if (!Array.isArray(extensions) || extensions.some((e) => typeof e !== "string")) throw new Error("external-services.extensions must be an array of strings");

  const files = [];
  const seen = new Set();
  for (const root of roots) {
    const walked = io.walk(
      root,
      (rel, name) => {
        if (seen.has(rel) || !extensions.some((e) => name.endsWith(e)) || TEST_FILE.test(rel)) return;
        seen.add(rel);
        files.push(rel);
      },
      { enter: (rel, name) => !NEVER_ENTER.has(name) },
    );
    if (!walked.exists) diagnostics.push(`${root} not found — nothing to inventory`);
    if (walked.truncated) diagnostics.push(`${root}: walk truncated — the scan under it is incomplete`);
  }
  files.sort();

  const hits = new Map(declared.map((s) => [s.name, { importSites: [], envSites: [], markers: new Set() }]));
  const candidates = new Map(); // prefix -> { names: Set, files: Set }
  for (const rel of files) {
    const r = io.read(rel, { maxBytes: MAX_SOURCE_BYTES });
    if (!r.ok) {
      if (r.code !== "missing") diagnostics.push(`${rel} ${r.reason}`);
      continue;
    }
    const imports = scanImports(r.text);
    const env = scanEnvReads(r.text);
    const covered = new Set();
    for (const s of declared) {
      const h = hits.get(s.name);
      for (const spec of imports) for (const marker of s.imports) if (importMatches(spec, marker)) {
        if (!h.importSites.includes(rel)) h.importSites.push(rel);
        h.markers.add(`import ${marker}`);
      }
      for (const name of env) for (const prefix of s.env) if (name.startsWith(prefix) || name.replace(PUBLIC_PREFIXES, "").startsWith(prefix)) {
        if (!h.envSites.includes(rel)) h.envSites.push(rel);
        h.markers.add(`env ${prefix}`);
        covered.add(name);
      }
    }
    for (const name of env) {
      if (covered.has(name) || !CANDIDATE_SUFFIXES.some((suf) => name.endsWith(suf))) continue;
      const prefix = envPrefixOf(name);
      if (!prefix || ignore.has(prefix)) continue;
      const c = candidates.get(prefix) ?? { names: new Set(), files: new Set() };
      c.names.add(name);
      c.files.add(rel);
      candidates.set(prefix, c);
    }
  }

  const records = [];
  for (const s of declared) {
    const h = hits.get(s.name);
    const usedBy = [...new Set([...h.importSites, ...h.envSites])].sort();
    if (!usedBy.length) {
      diagnostics.push(`service '${s.name}' is declared but nothing imports ${s.imports.join(", ") || "its packages"} or reads ${s.env.join(", ") || "its env names"} — no record`);
      continue;
    }
    const resource = [...h.importSites].sort()[0] ?? [...h.envSites].sort()[0];
    const at = usedBy.map((f) => `?at:${f}`);
    records.push({
      kind,
      id: `${kind}:${slug(s.name)}`,
      title: s.name,
      description: "",
      resource: [resource],
      refs: at,
      facts: { markers: [...h.markers].sort(), usedBy, edges: { usedBy: at } },
      filename: `${slug(s.name)}.json`,
    });
  }
  records.sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const [prefix, c] of [...candidates].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const names = [...c.names].sort();
    const where = [...c.files].sort();
    warnings.push(`${names.join(", ")} read in ${where.join(", ")} matches no declared service — add { "name": "…", "env": ["${prefix}_"] } to extractorOptions["${label}"].services, or "${prefix}" to its ignore list`);
  }
  if (!declared.length) diagnostics.push("no services declared — nothing to inventory (candidates are still reported)");
  return { records, diagnostics, warnings };
}
