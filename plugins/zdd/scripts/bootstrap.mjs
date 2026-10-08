#!/usr/bin/env node
// The bootstrap runbook's deterministic half. The `bootstrap` skill is the
// conversation — it asks the questions — and this script is the only thing
// that reads the adopter's stack and writes into the adopter's repo. Splitting
// it this way is what makes the runbook testable at the file seam: drive the
// script with a scripted answer set against a fixture repo and assert what
// landed on disk, no LLM in the loop.
//
//   bootstrap.mjs detect  [--root=<dir>] [--home=<dir>] [--json]
//       Scan for each extractor's convention. Prints a proposal — extractor
//       set + options, with the EVIDENCE for each — or "greenfield" when there
//       is no source to read. Also reports whether the mattpocock-skills
//       plugin is installed (the recommendation step). Writes nothing.
//
//   bootstrap.mjs apply --answers=<file.json> [--root=<dir>] [--date=YYYY-MM-DD] [--json]
//       Write the setup from an answer set (shape below). Idempotent: an
//       artifact that already exists is KEPT, never overwritten — curated
//       content is the adopter's, and a second run only fills gaps. On a repo
//       that already has a config (repair), an omitted answer keeps the
//       current choice; only an explicit answer changes it.
//
//   bootstrap.mjs upgrade [--lock] [--root=<dir>] [--json]
//       The only later writer into an adopter's repo. Migrates `adapter` →
//       `extractors`, moves `viewer.nonAreaTags` to the top level, rewrites
//       every plugin-OWNED file (engine pins, the managed hook, the marked
//       snippet blocks) to this plugin's version, moves our release lock's
//       ref (decision 0021; `--lock` writes an absent one, on the user's
//       word), and names every file it changed. Never touches a curated
//       artifact or a file it does not own.
//
// Trust: the answer set, the existing config, and everything in the checkout
// are untrusted input. Answers are validated whole before the first write;
// a config that exists but cannot be read stops the run; every path is
// validated repo-relative and resolved through resolveInside (no escape, no
// symlink); files the plugin writes carry an ownership line and only owned
// files are ever rewritten (review CR-002..CR-013, CR-029).
//
// Answer set (every key optional):
//   {
//     "name": "My App", "repoBase": "https://github.com/o/r/tree/main/", "baseBranch": "main",
//     "extractors": ["supabase", "fastapi"],          // else derived from `stack`, else the detection
//     "extractorOptions": { ... },                     // else defaults per extractor
//     "stack": ["FastAPI", "Supabase", "React web", "Expo"],   // greenfield answers; strings or {name, path}
//     "apps": ["Web", "Mobile"],                       // map skeleton (Application concepts); else from `stack` / detection
//     "optIns": { "autoLoad": true, "fence": true, "stop": true, "ci": true, "prePush": true },   // defaults: all on (repair: current state)
//     "codex": false,                                  // also write AGENTS.md
//     "seedAdr": true                                  // ADR-0001 "Adopt Zero-Drift Docs"
//   }

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, lstatSync, chmodSync, openSync, writeSync, closeSync } from "node:fs";
import { join, dirname, basename, relative } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  PLUGIN_ROOT,
  ENGINE_PACKAGE,
  pluginVersion,
  parseArgs,
  adopterRoot,
  readJson,
  readConfig,
  artifactPaths,
  repoRelative,
  resolveInside,
  findPocock,
  posixify,
  pocockPin,
  pluginSettings,
  ZDD_PLUGIN_ID,
  MARKETPLACE,
  MARKETPLACE_REPO,
  isOurDeclaration,
} from "./lib/repo.mjs";

const TEMPLATES = join(PLUGIN_ROOT, "templates");
const SNIPPET_BEGIN = "<!-- zdd:begin -->";
const SNIPPET_END = "<!-- zdd:end -->";
const LEGACY_SNIPPET_HEADING = "## Documentation — Zero-Drift Docs (ZDD)";
// The v0.3.1 snippet's fingerprint. Replacement needs the whole section to
// equal the v0.3.1 snippet modulo whitespace (CR-080, isLegacySnippet below);
// the fingerprint only decides whether a section that is NOT replaced gets
// the "legacy section left in place" note (both bullets present ⇒ it started
// as ours and was edited) or is simply the adopter's own heading (CR-011).
const LEGACY_FINGERPRINT = ["/zdd:orient", "/zdd:update"];
// Ownership line carried by every file the plugin writes besides config.
export const OWNER_MARK = "Managed by Zero-Drift Docs (zdd)";
// Mirrors of the engine's services extractor (src/extractors/services/
// index.mjs: CANDIDATE_SUFFIXES, BUILT_IN_IGNORE) — the plugin cannot import
// the engine under npx; a test keeps the two pairs equal.
export const SERVICE_SUFFIXES = ["_API_KEY", "_DSN", "_SECRET", "_TOKEN", "_URL", "_KEY"];
export const SERVICE_IGNORE = ["DATABASE", "SUPABASE", "PG", "POSTGRES", "NODE", "NEXT", "VITE", "EXPO", "PUBLIC", "CI", "GITHUB", "RAILWAY", "VERCEL", "PORT", "HOST", "BASE", "API", "APP", "WEB", "SERVER", "CLIENT", "AUTH", "JWT", "SESSION", "COOKIE", "TEST", "DEV", "LOG"];

const SKIP_DIRS = new Set(["node_modules", ".git", ".next", "dist", "build", "coverage", ".venv", "venv", "__pycache__", ".expo", "zdd"]);
const MAX_NAME = 120;
const MAX_SCAN_BYTES = 1024 * 1024; // detection never reads a file larger than this (CR-091)
// The react-router probe reads JS/TS source to find a route tree; this is the
// most it reads in total (CAS-63 review CR-008). Past it, detection stops
// reading and says so — a proposal, not an inventory.
const MAX_PROBE_BYTES = 64 * 1024 * 1024;

// Mirror of the engine's LEGACY_ADAPTERS (src/lib/config.mjs): the one legacy
// adapter and how its options split. The engine expands it at derive time;
// this is the migration that makes the expansion unnecessary.
const LEGACY_ADAPTERS = {
  "nextjs-supabase": {
    extractors: ["supabase", "nextjs"],
    split(options = {}) {
      const { migrationNamespaces = [], externalBuckets = [], ...nextjs } = options;
      return { supabase: { migrationNamespaces, externalBuckets }, nextjs };
    },
  },
};

// ---------------------------------------------------------------------------
// Detection — one probe per extractor convention, each returning the evidence
// it found and the options that evidence implies. Purely file-shaped and
// sorted, so the proposal is the same for the same tree. Symlinks are never
// followed (CR-004): a link is skipped, whatever it points at.
// ---------------------------------------------------------------------------
function walk(root, onFile, maxDepth = 6) {
  const rec = (dir, depth) => {
    if (depth > maxDepth) return;
    let names;
    try {
      names = readdirSync(dir).sort();
    } catch {
      return;
    }
    for (const name of names) {
      const p = join(dir, name);
      let st;
      try {
        st = lstatSync(p);
      } catch {
        continue;
      }
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) {
        if (!SKIP_DIRS.has(name) && !name.startsWith(".")) rec(p, depth + 1);
      } else if (st.isFile()) {
        // A file over the cap is not a convention to inventory (a generated
        // blob, a vendored bundle) and is never read (CR-091).
        if (st.size > MAX_SCAN_BYTES) continue;
        onFile(p, name, posixify(relative(root, p)));
      }
    }
  };
  rec(root, 0);
}

function readPackageJson(root) {
  const p = join(root, "package.json");
  try {
    const st = lstatSync(p);
    if (!st.isFile() || st.size > MAX_SCAN_BYTES) return null; // CR-091: same bound as the walk
    return readJson(p);
  } catch {
    return null;
  }
}

// Namespace names for several migration dirs: the path above `migrations`,
// minus the conventional `supabase` segment, made unique (CR-012).
function namespaceNames(dirs) {
  if (dirs.length === 1) return ["db"];
  const names = dirs.map((d) => {
    const segs = d.split("/").filter((s) => s && s !== "migrations" && s !== "supabase");
    return segs.length ? segs.join("-") : "db";
  });
  return dedupe(names);
}
// Unique names, checked against the whole set: a raw `foo-2` sitting next to
// two `foo`s cannot be collided into (review CR-047).
function dedupe(names) {
  const taken = new Set(names); // every raw name is reserved before any suffix is minted
  const seen = new Set();
  return names.map((n) => {
    if (!seen.has(n)) {
      seen.add(n);
      return n;
    }
    let candidate;
    for (let i = 2; taken.has((candidate = `${n}-${i}`)); i++);
    taken.add(candidate);
    return candidate;
  });
}

export function detect(root) {
  const sqlDirs = new Map(); // dir -> count
  const pyRouters = new Map(); // dir -> { routers, apps }
  const pyRoots = new Set();
  let appDir = null;
  let middlewarePath = null;
  const routesFiles = []; // react-router: files declaring a route tree in code
  const packageJsons = []; // nested package.json files (workspaces)
  // ZDD 2.1 (CAS-97): the four opt-in extractors' signals.
  const tsxFiles = []; // components: every .tsx/.jsx file (bounded); roots are computed after the walk
  const MAX_TSX = 20_000;
  const expoAppDirs = new Set(); // expo-router: an `app/` folder holding a `_layout` file
  const jobManifests = []; // jobs: { manifest, scripts } with a job-shaped command
  const envCandidates = new Map(); // services: env prefix -> { names, files, imports }
  const importSpecs = new Set(); // every package imported anywhere, for the services' import markers
  let probeBytes = 0;
  let probeTruncated = false;
  const skippedRoutesFiles = []; // route trees at paths the engine would refuse
  let sourceFiles = 0;

  walk(root, (abs, name, rel) => {
    if (/\.(ts|tsx|js|jsx|py|sql|go|rb|rs|java|cs)$/.test(name)) sourceFiles++;
    if (name === "package.json" && rel !== "package.json") packageJsons.push(rel);
    if (name.endsWith(".sql") && /(^|\/)migrations\//.test(rel + "/")) {
      const dir = posixify(dirname(rel));
      sqlDirs.set(dir, (sqlDirs.get(dir) ?? 0) + 1);
    }
    // components: every .tsx/.jsx file, counted under its nearest `src/`
    // (or, without one, its top-level folder) — the roots to propose.
    if (/\.(tsx|jsx)$/.test(name) && !/\.(test|spec|stories|story)\.[tj]sx$/.test(name) && tsxFiles.length < MAX_TSX) tsxFiles.push(rel);
    // expo-router: a `_layout` file under an `app/` folder (Next.js's is `layout`).
    if (/^_layout\.(tsx|jsx|ts|js)$/.test(name)) {
      const segs = posixify(dirname(rel)).split("/");
      const app = segs.lastIndexOf("app");
      if (app !== -1) expoAppDirs.add(segs.slice(0, app + 1).join("/"));
    }
    // jobs: a manifest naming a process — a package script that runs a
    // module (`python -m x`, `node x.mjs`), a Procfile line, a Railway file.
    if (name === "package.json" || name === "Procfile" || name === "railway.toml" || name === "railway.json") {
      let text = "";
      try {
        text = readFileSync(abs, "utf8");
      } catch {
        return;
      }
      const jobShaped = (cmd) => /(?:^|\s)python[0-9.]*\s+-m\s+[\w.]+/.test(cmd) || /(?:^|\s)(?:node|tsx|ts-node|bun|deno)\s+(?:-[^\s]+\s+)*[\w./-]+\.(?:m?[jt]s|cjs)\b/.test(cmd);
      const notAJob = (n) => /^(dev|start|test|lint|build|typecheck|format|prepare|postinstall)$/.test(n) || /^(test|lint|build|check|typecheck|format)[:.-]/.test(n);
      if (name === "package.json") {
        try {
          const scripts = JSON.parse(text).scripts ?? {};
          const hits = Object.entries(scripts).filter(([n, c]) => !notAJob(n) && typeof c === "string" && jobShaped(c)).map(([n]) => n).sort();
          if (hits.length) jobManifests.push({ manifest: rel, scripts: hits });
        } catch {
          /* not JSON: not a manifest */
        }
      } else if (name === "Procfile") {
        const hits = text.split("\n").map((l) => /^\s*([A-Za-z_][\w-]*)\s*:\s*(.+)$/.exec(l)).filter((m) => m && m[1] !== "web" && jobShaped(m[2])).map((m) => m[1]);
        if (hits.length) jobManifests.push({ manifest: rel, scripts: hits });
      } else if (/startCommand/.test(text)) jobManifests.push({ manifest: rel, scripts: ["startCommand"] });
    }
    // services: environment variable NAMES read in source whose suffix says
    // "a credential or an address", grouped by prefix — a mirror of the
    // engine's services extractor (a test pins the two lists together), so
    // the proposal and the warning agree. Names only, never a value.
    if (/\.(py|ts|tsx|js|jsx|mjs|cjs)$/.test(name) && !/\.(test|spec|stories)\.[cm]?[jt]sx?$|\.d\.ts$/.test(name) && !/(^|\/)(test_[^/]*\.py|[^/]*_test\.py|conftest\.py)$/.test(rel)) {
      let text = "";
      try {
        text = readFileSync(abs, "utf8");
      } catch {
        return;
      }
      for (const m of text.matchAll(/^\s*import\s+([\w.]+)\s*(?:#.*)?$/gm)) importSpecs.add(m[1]);
      for (const m of text.matchAll(/^\s*from\s+([\w.]+)\s+import\b/gm)) importSpecs.add(m[1]);
      for (const m of text.matchAll(/\bimport\s*(?:[^'"`;]*?\bfrom\s*)?(['"])([^'"]+)\1|\brequire\s*\(\s*(['"])([^'"]+)\3\s*\)/g)) importSpecs.add(m[2] ?? m[4]);
      const NAME = "([A-Z][A-Z0-9_]{2,})";
      const reads = [
        new RegExp(`\\bos\\.environ(?:\\.get)?\\s*[\\[(]\\s*['"]${NAME}['"]`, "g"),
        new RegExp(`\\bos\\.getenv\\s*\\(\\s*['"]${NAME}['"]`, "g"),
        new RegExp(`\\.get\\s*\\(\\s*['"]${NAME}['"]`, "g"),
        new RegExp(`\\bprocess\\.env(?:\\.${NAME}|\\s*\\[\\s*['"]${NAME}['"])`, "g"),
        new RegExp(`\\bimport\\.meta\\.env(?:\\.${NAME}|\\s*\\[\\s*['"]${NAME}['"])`, "g"),
        new RegExp(`\\bDeno\\.env\\.get\\s*\\(\\s*['"]${NAME}['"]`, "g"),
      ];
      for (const re of reads) {
        for (const m of text.matchAll(re)) {
          const envName = m[1] ?? m[2];
          if (!SERVICE_SUFFIXES.some((suf) => envName.endsWith(suf))) continue;
          const prefix = envName.replace(/^(NEXT_PUBLIC_|VITE_|EXPO_PUBLIC_|REACT_APP_|PUBLIC_)/, "").split("_")[0];
          if (!prefix || SERVICE_IGNORE.includes(prefix)) continue;
          const c = envCandidates.get(prefix) ?? { names: new Set(), files: new Set() };
          c.names.add(envName);
          c.files.add(rel);
          envCandidates.set(prefix, c);
        }
      }
    }
    if (name.endsWith(".py")) {
      let text = "";
      try {
        text = readFileSync(abs, "utf8");
      } catch {
        return;
      }
      const routers = /\bAPIRouter\s*\(/.test(text);
      const app = /\bFastAPI\s*\(/.test(text);
      if (routers || app) {
        const dir = posixify(dirname(rel));
        const cur = pyRouters.get(dir) ?? { routers: 0, apps: 0 };
        if (routers) cur.routers++;
        if (app) cur.apps++;
        pyRouters.set(dir, cur);
        // The scan root is the top-level file or the first path segment.
        pyRoots.add(dir === "." ? rel : rel.split("/")[0]);
      }
    }
    if (/^(page|route|layout)\.(tsx|ts|jsx|js)$/.test(name)) {
      const m = /^(.*?(?:^|\/)app)(\/|$)/.exec(posixify(dirname(rel)) + "/");
      if (m && (!appDir || m[1].length < appDir.length)) appDir = m[1];
    }
    if (/^middleware\.(ts|js)$/.test(name) && rel.split("/").length <= 2) middlewarePath = rel;
    // A React Router route tree declared in code: the array form or the JSX
    // form, in a .tsx/.jsx/.ts/.js file that imports react-router.
    if (/\.(tsx|jsx|ts|js)$/.test(name) && !/\.(test|spec|stories|story)\.[tj]sx?$/.test(name) && !/\.d\.ts$/.test(name)) {
      let st;
      try {
        st = lstatSync(abs);
      } catch {
        return;
      }
      if (probeBytes + st.size > MAX_PROBE_BYTES) {
        probeTruncated = true;
        return;
      }
      probeBytes += st.size;
      let text = "";
      try {
        text = readFileSync(abs, "utf8");
      } catch {
        return;
      }
      // A detected path must be one the engine will accept (CR-009): the
      // engine's path rule refuses whitespace and control characters.
      if (/from\s*['"]react-router(-dom)?['"]/.test(text) && /\bcreate(?:Browser|Hash|Memory)Router\s*\(|:\s*RouteObject\[\]\s*=|<Route\b/.test(text)) {
        try {
          enginePath(rel, "routesFile");
          routesFiles.push(rel);
        } catch {
          skippedRoutesFiles.push(rel);
        }
      }
    }
  });
  routesFiles.sort();

  const pkg = readPackageJson(root);
  const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) };
  // Workspace packages' dependencies too (`apps/web/package.json`) — a
  // monorepo's web app declares react-router in its own manifest.
  const nestedDeps = new Map(); // dep name -> first workspace dir declaring it (sorted)
  for (const rel of packageJsons.sort()) {
    const sub = readPackageJson(join(root, dirname(rel)));
    for (const d of Object.keys({ ...(sub?.dependencies ?? {}), ...(sub?.devDependencies ?? {}) })) if (!nestedDeps.has(d)) nestedDeps.set(d, posixify(dirname(rel)));
  }
  const proposals = [];

  if (sqlDirs.size) {
    const dirs = [...sqlDirs.keys()].sort();
    const names = namespaceNames(dirs);
    proposals.push({
      name: "supabase",
      evidence: dirs.map((d) => `SQL migrations under \`${d}\` (${sqlDirs.get(d)} file${sqlDirs.get(d) === 1 ? "" : "s"})`),
      options: { migrationNamespaces: dirs.map((d, i) => ({ name: names[i], dir: d })) },
    });
  }
  if (appDir || deps.next) {
    const ev = [];
    if (appDir) ev.push(`App Router tree at \`${appDir}\` (page/route/layout files)`);
    if (deps.next) ev.push(`\`next\` in package.json dependencies`);
    if (middlewarePath) ev.push(`\`${middlewarePath}\` present`);
    const options = { appDir: appDir ?? "src/app", apiPrefix: "/api" };
    if (middlewarePath) options.middlewarePath = middlewarePath;
    proposals.push({ name: "nextjs", evidence: ev, options });
  }
  if (pyRouters.size) {
    const ev = [];
    for (const [dir, c] of [...pyRouters.entries()].sort()) {
      if (c.apps) ev.push(dir === "." ? "`FastAPI()` app at the repo root" : `\`FastAPI()\` app under \`${dir}\``);
      if (c.routers) ev.push(`\`APIRouter\` under \`${dir}\``);
    }
    proposals.push({ name: "fastapi", evidence: ev, options: { roots: [...pyRoots].sort() } });
  }

  // react-router: the routes file is the evidence; a bare dependency with no
  // tree yet is proposed at the convention's default path (like `next`).
  const rrDeps = ["react-router", "react-router-dom"];
  const reactRouterDep = rrDeps.some((d) => deps[d] || nestedDeps.has(d));
  // A dependency-only proposal sits at the convention's default path INSIDE
  // the workspace package that declares it (CR-021), else the root.
  const rrDir = rrDeps.some((d) => deps[d]) ? "" : (rrDeps.map((d) => nestedDeps.get(d)).find(Boolean) ?? "");
  if (routesFiles.length || reactRouterDep || skippedRoutesFiles.length) {
    const ev = [];
    if (routesFiles.length) ev.push(`route tree declared in \`${routesFiles[0]}\`${routesFiles.length > 1 ? ` (also: ${routesFiles.slice(1).map((f) => `\`${f}\``).join(", ")} — one routesFile per extractor; confirm which)` : ""}`);
    if (reactRouterDep) ev.push(`\`react-router\` in ${rrDir ? `\`${rrDir}/package.json\`` : "package.json"} dependencies`);
    if (skippedRoutesFiles.length) ev.push(`route tree at ${skippedRoutesFiles.map((f) => `\`${f}\``).join(", ")} skipped — the path has whitespace or control characters the engine refuses; rename it`);
    if (probeTruncated) ev.push(`detection stopped reading source after ${MAX_PROBE_BYTES / (1024 * 1024)} MiB — confirm the routes file by hand`);
    proposals.push({ name: "react-router", evidence: ev, options: { routesFile: routesFiles[0] ?? posixify(join(rrDir, "src/routes.tsx")) } });
  }

  // ZDD 2.1's opt-ins (CAS-97). Each is proposed on its own evidence; an
  // adopter who says no to one sees nothing change.
  // A component root is the file's nearest `src/`; without one, the nearest
  // folder holding a package.json (a workspace app); without that, the
  // top-level folder (or the repo root for a root-level file).
  const packageDirs = packageJsons.map((rel) => posixify(dirname(rel))).sort((a, b) => b.length - a.length);
  const tsxDirs = new Map();
  for (const rel of tsxFiles) {
    const segs = rel.split("/");
    const src = segs.lastIndexOf("src");
    let root;
    if (src !== -1) root = segs.slice(0, src + 1).join("/");
    else root = packageDirs.find((d) => rel.startsWith(`${d}/`)) ?? (segs.length > 1 ? segs[0] : ".");
    tsxDirs.set(root, (tsxDirs.get(root) ?? 0) + 1);
  }
  if (tsxDirs.size) {
    const dirs = [...tsxDirs.keys()].sort();
    proposals.push({
      name: "components",
      evidence: dirs.map((d) => `${tsxDirs.get(d)} .tsx/.jsx file${tsxDirs.get(d) === 1 ? "" : "s"} under \`${d}\``),
      options: { roots: dirs },
    });
  }
  const expoDirs = [...expoAppDirs].sort();
  if (expoDirs.length) {
    proposals.push({
      name: "expo-router",
      evidence: [`Expo Router tree at \`${expoDirs[0]}\` (a \`_layout\` file)${expoDirs.length > 1 ? ` — also ${expoDirs.slice(1).map((d) => `\`${d}\``).join(", ")}; one appDir per extractor, confirm which` : ""}`],
      options: { appDir: expoDirs[0] },
    });
  }
  if (jobManifests.length) {
    jobManifests.sort((a, b) => (a.manifest < b.manifest ? -1 : 1));
    proposals.push({
      name: "jobs",
      evidence: jobManifests.map((m) => `\`${m.manifest}\` runs a process: ${m.scripts.map((s) => `\`${s}\``).join(", ")}`).concat(["the mode (worker or scheduled) is never guessed: a committed railway.toml/json states it, else set extractorOptions.jobs.modes after bootstrap — lint names the ones left unknown"]),
      options: {},
    });
  }
  if (envCandidates.size) {
    const services = [];
    const evidence = [];
    for (const [prefix, c] of [...envCandidates].sort(([a], [b]) => (a < b ? -1 : 1))) {
      const imports = [...importSpecs].filter((spec) => spec.toLowerCase().replace(/^@/, "").split(/[/.]/)[0].replace(/[-_]/g, "").includes(prefix.toLowerCase().replace(/[-_]/g, ""))).sort();
      const entry = { name: prefix.charAt(0) + prefix.slice(1).toLowerCase(), env: [`${prefix}_`] };
      if (imports.length) entry.imports = imports;
      services.push(entry);
      evidence.push(`\`${[...c.names].sort().join("`, `")}\` read in ${[...c.files].sort().map((f) => `\`${f}\``).join(", ")}${imports.length ? `; imports ${imports.map((i) => `\`${i}\``).join(", ")}` : ""} → service "${entry.name}"`);
    }
    evidence.push("usedBy lists the files carrying a service's marker (its env name or a matching import), never the files that reach the provider through a settings object or a wrapper — say so when proposing");
    evidence.push("names are guessed from the env prefix — confirm or rename each; a prefix that is not a service goes in `ignore`");
    proposals.push({ name: "services", evidence, options: { services } });
  }

  const apps = [];
  if (deps.expo || deps["expo-router"] || nestedDeps.has("expo") || nestedDeps.has("expo-router") || expoDirs.length) apps.push({ name: "Mobile (Expo)", evidence: expoDirs.length ? `Expo Router tree at \`${expoDirs[0]}\`` : "`expo` in package.json", extractor: expoDirs.length ? "expo-router (proposed above)" : "expo-router — switched on by an `app/` folder with a `_layout` file (ZDD 2.1, early); map-only until then" });
  if (routesFiles.length || reactRouterDep || skippedRoutesFiles.length) apps.push({ name: "Web (React)", evidence: routesFiles.length ? `route tree in \`${routesFiles[0]}\`` : reactRouterDep ? "`react-router` in package.json" : `route tree at a refused path (\`${skippedRoutesFiles[0]}\`)`, extractor: "react-router (proposed above)" });

  const mode = sourceFiles === 0 && !pkg ? "greenfield" : "existing";
  if (mode === "existing" && !proposals.length) {
    proposals.push({ name: "generic", evidence: ["source present but no known convention found — map-only ZDD; scaffold an extractor for it with the `extractor` skill once bootstrap is done"], options: {} });
  }
  // Questions the evidence raises but cannot answer (CAS-101). Supabase beside
  // a web app: Realtime subscriptions become `subscribes` edges, the client's
  // own call is seen, a wrapper of the app's own is not until it is named.
  // One question per web extractor (CR-009): a repo with both a Next.js and a
  // React Router app may wrap Realtime differently in each.
  const questions = [];
  const names = proposals.map((p) => p.name);
  if (names.includes("supabase")) {
    for (const web of ["react-router", "nextjs"].filter((n) => names.includes(n))) {
      questions.push({
        topic: "realtime",
        ask:
          `Does the ${web === "nextjs" ? "Next.js" : "React Router"} app subscribe to Supabase Realtime through a wrapper of its own (e.g. \`live.onInsert("table", …)\`)? ` +
          'The client\'s own `.on("postgres_changes", { table })` needs nothing; a wrapper is invisible until its call names are listed in subscribeCalls',
        records: SUBSCRIBE_CALLS[web],
      });
    }
  }
  return { mode, proposals, apps, sourceFiles, questions };
}

// ---------------------------------------------------------------------------
// Greenfield: the answers name a stack; map each part to an extractor with
// its future paths, or to an Application concept for the map when no
// extractor exists yet.
// ---------------------------------------------------------------------------
const STACK_RULES = [
  { match: /fastapi/i, extractor: "fastapi", options: (path) => ({ roots: [path || "api"] }) },
  { match: /supabase|postgres/i, extractor: "supabase", options: (path) => ({ migrationNamespaces: [{ name: "db", dir: path || "supabase/migrations" }] }) },
  { match: /next(\.js)?/i, extractor: "nextjs", options: (path) => ({ appDir: path || "src/app", apiPrefix: "/api" }) },
  // An EXPLICIT Expo Router entry selects the extractor (at its future app
  // folder); a bare "Expo" is the Application alone.
  { match: /expo.?router/i, extractor: "expo-router", options: (path) => ({ appDir: path || "app" }), app: "Mobile (Expo)" },
  { match: /expo|react.?native/i, app: "Mobile (Expo)" },
  // Only an EXPLICIT React Router entry selects the extractor (at its future
  // routes file) — "React web", "Vite", "web" could be Vue, Svelte or another
  // router (CR-014); those stay an Application concept until the router is
  // named. Both get the Application.
  { match: /react.?router/i, extractor: "react-router", options: (path) => ({ routesFile: path || "src/routes.tsx" }), app: "Web (React)" },
  { match: /react|web|vite/i, app: "Web (React)" },
];

function fromStack(stack = []) {
  const extractors = [];
  const extractorOptions = {};
  const apps = [];
  for (const entry of stack) {
    const name = typeof entry === "string" ? entry : entry.name;
    const path = typeof entry === "string" || entry.path === undefined ? undefined : repoRelative(entry.path, `stack entry ${name} path`);
    const rule = STACK_RULES.find((r) => r.match.test(name));
    if (!rule) {
      apps.push(name);
      continue;
    }
    if (rule.app && !apps.includes(rule.app)) apps.push(rule.app);
    if (rule.extractor) {
      const opts = rule.options(path);
      if (!extractors.includes(rule.extractor)) {
        extractors.push(rule.extractor);
        extractorOptions[rule.extractor] = opts;
      } else {
        // A second entry for the same extractor adds its path (CR-042).
        const cur = extractorOptions[rule.extractor];
        for (const [k, v] of Object.entries(opts)) {
          if (Array.isArray(v) && Array.isArray(cur[k])) {
            for (const item of v) if (!cur[k].some((x) => JSON.stringify(x) === JSON.stringify(item))) cur[k].push(item);
          } else if (JSON.stringify(cur[k]) !== JSON.stringify(v)) {
            fail(`two stack entries give different ${rule.extractor}.${k} (${JSON.stringify(cur[k])} vs ${JSON.stringify(v)}) — an extractor has one ${k}; choose one`);
          }
        }
        if (Array.isArray(cur.migrationNamespaces)) {
          const names = dedupe(cur.migrationNamespaces.map((m) => m.name));
          cur.migrationNamespaces.forEach((m, i) => (m.name = names[i]));
        }
      }
    }
  }
  return { extractors, extractorOptions, apps };
}

// ---------------------------------------------------------------------------
// Answer validation — the whole set, before the first write (CR-029, CR-009).
// ---------------------------------------------------------------------------
const isName = (s) => typeof s === "string" && s.length > 0 && s.length <= MAX_NAME && !/[\x00-\x1f\x7f]/.test(s) && s.trim() === s;
const fail = (msg) => {
  throw new Error(`answers: ${msg}`);
};

// Mirrors of the ENGINE's rules (src/lib/config.mjs validateRepoBase and
// src/lib/paths.mjs repoRelative), applied to the answers so a config the
// engine's first derive would refuse is never written (CR-078). The engine's
// path rule is stricter than the plugin's repoRelative in lib/repo.mjs (no
// whitespace, no backslash) and looser in one spot (`.` is a valid root — the
// fastapi default), and the option values land in config.json verbatim, so
// the engine's rule is the one that applies here.
const ENGINE_REPO_BASE = /^https?:\/\/\S+$/i;
function enginePath(value, label) {
  const bad = () => fail(`${label} ${JSON.stringify(value)} must be repo-relative (no absolute path, drive letter, URL scheme, backslash, whitespace or '..')`);
  if (typeof value !== "string" || !value.length) bad();
  if (/[\s\x00-\x1f\x7f]/.test(value)) bad();
  if (value.includes("\\") || value.startsWith("/") || /^[A-Za-z]:/.test(value)) bad();
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)) bad();
  if (value.split("/").some((s) => s === "..")) bad();
  return value;
}
// The path-bearing option keys of the built-in extractors, by extractor name.
// A local extractor's options are its own; only these are inspected.
// Where each web extractor names its Realtime wrapper calls (ZDD 2.1).
const SUBSCRIBE_CALLS = { nextjs: "extractorOptions.nextjs.refs.subscribeCalls", "react-router": "extractorOptions.react-router.subscribeCalls" };
const isCallList = (v) => Array.isArray(v) && v.every((s) => typeof s === "string" && s.length > 0 && s.length <= MAX_NAME);

function validateExtractorOptions(all) {
  const obj = (v) => v && typeof v === "object" && !Array.isArray(v);
  const list = (v, label) => {
    if (!Array.isArray(v)) fail(`${label} must be an array of repo-relative paths`);
    v.forEach((p, i) => enginePath(p, `${label}[${i}]`));
  };
  const calls = (v, label) => {
    if (v !== undefined && !isCallList(v)) fail(`${label} must be an array of call names (strings), e.g. ["live.onInsert"]`); // CR-011
  };
  for (const [name, opts] of Object.entries(all)) {
    if (!obj(opts)) fail(`extractorOptions.${name} must be an object`);
    if (name === "nextjs") {
      for (const k of ["appDir", "middlewarePath", "srcAliasRoot"]) if (opts[k] !== undefined) enginePath(opts[k], `nextjs.${k}`);
      if (opts.refs !== undefined) {
        if (!obj(opts.refs)) fail("nextjs.refs must be an object");
        if (opts.refs.roots !== undefined) list(opts.refs.roots, "nextjs.refs.roots");
        calls(opts.refs.subscribeCalls, "nextjs.refs.subscribeCalls");
      }
    } else if (name === "react-router") {
      for (const k of ["routesFile", "srcAliasRoot"]) if (opts[k] !== undefined) enginePath(opts[k], `react-router.${k}`);
      calls(opts.subscribeCalls, "react-router.subscribeCalls");
    } else if (name === "services") {
      if (opts.roots !== undefined) list(opts.roots, "services.roots");
    } else if (name === "jobs") {
      if (opts.roots !== undefined) list(opts.roots, "jobs.roots");
    } else if (name === "expo-router") {
      for (const k of ["appDir", "srcAliasRoot"]) if (opts[k] !== undefined) enginePath(opts[k], `expo-router.${k}`);
    } else if (name === "components") {
      if (opts.roots !== undefined) list(opts.roots, "components.roots");
      if (opts.srcAliasRoot !== undefined) enginePath(opts.srcAliasRoot, "components.srcAliasRoot");
    } else if (name === "fastapi") {
      if (opts.roots !== undefined) list(opts.roots, "fastapi.roots");
    } else if (name === "supabase" && opts.migrationNamespaces !== undefined) {
      if (!Array.isArray(opts.migrationNamespaces)) fail("supabase.migrationNamespaces must be an array");
      opts.migrationNamespaces.forEach((ns, i) => {
        if (!obj(ns)) fail(`supabase.migrationNamespaces[${i}] must be an object`);
        enginePath(ns.dir, `supabase.migrationNamespaces[${i}].dir`);
      });
    }
  }
}

export function validateAnswers(a) {
  if (!a || typeof a !== "object" || Array.isArray(a)) fail("must be a JSON object");
  for (const k of ["name", "repoBase", "baseBranch"]) if (a[k] !== undefined && !isName(a[k])) fail(`${k} must be a single-line string (≤${MAX_NAME} chars)`);
  if (a.repoBase !== undefined && a.repoBase !== "" && !ENGINE_REPO_BASE.test(a.repoBase)) fail("repoBase must be an http(s) URL with no whitespace, or empty (the engine's rule)");
  if (a.extractors !== undefined) {
    if (!Array.isArray(a.extractors) || !a.extractors.every((n) => typeof n === "string" && /^[a-z][a-z0-9-]*$/.test(n))) fail("extractors must be an array of extractor names");
    if (new Set(a.extractors).size !== a.extractors.length) fail("extractors lists a name twice");
  }
  if (a.extractorOptions !== undefined) {
    if (!a.extractorOptions || typeof a.extractorOptions !== "object" || Array.isArray(a.extractorOptions)) fail("extractorOptions must be an object");
    validateExtractorOptions(a.extractorOptions);
  }
  if (a.stack !== undefined) {
    if (!Array.isArray(a.stack)) fail("stack must be an array");
    for (const e of a.stack) {
      if (isName(e)) continue;
      if (!e || typeof e !== "object" || !isName(e.name)) fail("each stack entry is a name or { name, path }");
      if (e.path !== undefined) repoRelative(e.path, `stack entry ${e.name} path`);
    }
  }
  if (a.apps !== undefined && (!Array.isArray(a.apps) || !a.apps.every(isName))) fail("apps must be an array of single-line names");
  if (a.optIns !== undefined) {
    if (!a.optIns || typeof a.optIns !== "object" || Array.isArray(a.optIns)) fail("optIns must be an object");
    for (const [k, v] of Object.entries(a.optIns)) {
      if (!["autoLoad", "fence", "stop", "ci", "prePush"].includes(k)) fail(`optIns.${k} is not an opt-in`);
      if (typeof v !== "boolean") fail(`optIns.${k} must be true or false`);
    }
  }
  for (const k of ["codex", "seedAdr"]) if (a[k] !== undefined && typeof a[k] !== "boolean") fail(`${k} must be true or false`);
  return a;
}

// ---------------------------------------------------------------------------
// Writers. Every one reports what it did to the ledger — wrote / kept /
// skipped — so the runbook can narrate and the tests can assert. Every path
// goes through resolveInside; a new file is created exclusively (`wx`) so a
// file that appears between the check and the write is kept, not clobbered
// (CR-010).
// ---------------------------------------------------------------------------
export class Ledger {
  // dryRun (`upgrade --plan`, CAS-101): every write is recorded, none lands;
  // a later read of a file this run "wrote" sees the pending content, so a
  // plan computes exactly what the real run will.
  constructor(root, { dryRun = false } = {}) {
    this.root = root;
    this.dryRun = dryRun;
    this.pending = new Map();
    this.wrote = [];
    this.kept = [];
    this.skipped = [];
    this.notes = [];
  }
  abs(rel) {
    return resolveInside(this.root, rel, rel);
  }
  overwrite(rel, content) {
    const path = this.abs(rel);
    if (!this.wrote.includes(rel)) this.wrote.push(rel);
    if (this.dryRun) return void this.pending.set(rel, content);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
  create(rel, content, { executable = false } = {}) {
    if (this.dryRun) {
      if (this.exists(rel)) {
        this.kept.push(rel);
        return false;
      }
      this.pending.set(rel, content);
      this.wrote.push(rel);
      return true;
    }
    const path = this.abs(rel);
    mkdirSync(dirname(path), { recursive: true });
    let fd;
    try {
      fd = openSync(path, "wx");
    } catch (e) {
      if (e.code === "EEXIST") {
        this.kept.push(rel);
        return false;
      }
      throw e;
    }
    try {
      writeSync(fd, content);
    } finally {
      closeSync(fd);
    }
    if (executable) {
      try {
        chmodSync(path, 0o755);
      } catch {
        /* windows */
      }
    }
    this.wrote.push(rel);
    return true;
  }
  exists(rel) {
    if (this.pending.has(rel)) return true;
    try {
      return lstatSync(this.abs(rel)).isFile();
    } catch {
      return false;
    }
  }
  read(rel) {
    return this.pending.has(rel) ? this.pending.get(rel) : readFileSync(this.abs(rel), "utf8");
  }
}

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const slug = (s) =>
  s
    .toLowerCase()
    .replace(/\(.*?\)/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "app";

const yamlScalar = (s) => JSON.stringify(s); // a JSON string is a valid YAML double-quoted scalar

function snippetText() {
  return readFileSync(join(TEMPLATES, "claude-md-snippet.md"), "utf8");
}
// Ownership is the HEADER — the mark within the first three lines — not the
// phrase anywhere in the file (CR-006).
const isOwned = (text) => text.split(/\r?\n/, 3).some((l) => l.includes(OWNER_MARK));

// The v0.3.1 workflow template carried neither the ownership line nor a pin,
// so ownership of it is decided by content: sha256 of the file normalised to
// LF, trailing whitespace stripped, one final newline. Regenerate the constant
// with `git show v0.3.1:plugins/zdd/templates/zdd.yml` through normaliseText
// (the test fixture at test/fixtures/v0.3.1/zdd.yml is that exact file).
const LEGACY_WORKFLOW_SHA256 = "a5e8672339dc570c8c154ffed09f01e715f627116f96ec1ef508895a3b906653";
const normaliseText = (s) =>
  s
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.trimEnd())
    .join("\n")
    .trim() + "\n";
const isLegacyWorkflow = (text) => createHash("sha256").update(normaliseText(text)).digest("hex") === LEGACY_WORKFLOW_SHA256;
// Same idea for the v0.3.1 CLAUDE.md snippet, compared modulo ALL whitespace
// (editors reflow prose; a reflowed stock section is still stock — CR-080).
// Regenerate with `git show v0.3.1:plugins/zdd/templates/claude-md-snippet.md`
// through collapseWhitespace (fixture: test/fixtures/v0.3.1/claude-md-snippet.md).
const LEGACY_SNIPPET_SHA256 = "d4dca24f9b590def6ba926a8bb6660b91b74e72bc792a1d1bc32c85aadcb887d";
const collapseWhitespace = (s) => s.replace(/\s+/g, " ").trim();
const isLegacySnippet = (text) => createHash("sha256").update(collapseWhitespace(text)).digest("hex") === LEGACY_SNIPPET_SHA256;

// A marker counts only as a whole line (CR-011): `<!-- zdd:begin --> extra`
// is not a marker.
const MARKER_LINE = (m) => new RegExp("^" + m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\r?$", "gm");
function count(hay, marker) {
  return (hay.match(MARKER_LINE(marker)) ?? []).length;
}
function indexOfMarker(hay, marker) {
  const m = MARKER_LINE(marker).exec(hay);
  return m ? m.index : -1;
}

// Insert or refresh the managed block. Cases: exactly one well-formed marker
// pair (refresh in place); the v0.3.1 unmarked snippet, recognised by its
// fingerprint (replace that section, bounded by the next `## ` heading);
// nothing (append); markers present but malformed (refuse — CR-011). Line
// endings follow the file (CR-041).
export function upsertSnippet(existing, snippet) {
  const crlf = /\r\n/.test(existing);
  const norm = (s) => (crlf ? s.replace(/\r?\n/g, "\r\n") : s);
  const body = norm(snippet.trimEnd() + "\n");
  if (!existing) return { text: body, changed: true, how: "created" };
  const nb = count(existing, SNIPPET_BEGIN);
  const ne = count(existing, SNIPPET_END);
  if (nb || ne || existing.includes(SNIPPET_BEGIN) || existing.includes(SNIPPET_END)) {
    const b = indexOfMarker(existing, SNIPPET_BEGIN);
    const e = indexOfMarker(existing, SNIPPET_END);
    const stray = existing.split(SNIPPET_BEGIN).length - 1 !== 1 || existing.split(SNIPPET_END).length - 1 !== 1;
    if (nb !== 1 || ne !== 1 || e < b || stray) return { text: existing, changed: false, how: "refused: the zdd:begin / zdd:end markers are not exactly one well-formed pair — fix them by hand" };
    const next = existing.slice(0, b) + body.trimEnd() + existing.slice(e + SNIPPET_END.length);
    return { text: next, changed: next !== existing, how: "refreshed" };
  }
  const h = existing.indexOf(LEGACY_SNIPPET_HEADING);
  let legacyKept = false;
  if (h !== -1) {
    const after = existing.indexOf("\n## ", h + LEGACY_SNIPPET_HEADING.length);
    const end = after === -1 ? existing.length : after + 1;
    const section = existing.slice(h, end);
    if (isLegacySnippet(section)) {
      const next = existing.slice(0, h) + body + existing.slice(end);
      return { text: next, changed: true, how: "replaced the pre-0.4 snippet" };
    }
    // The heading is there but the section is not the stock snippet — an
    // adopter's line inside it, or their own section: leave it, append.
    legacyKept = LEGACY_FINGERPRINT.every((f) => section.includes(f));
  }
  const sep = existing.endsWith("\n") ? (/\r?\n\r?\n$/.test(existing) ? "" : norm("\n")) : norm("\n\n");
  return {
    text: existing + sep + body,
    changed: true,
    how: "appended",
    note: legacyKept ? `legacy section left in place: the "${LEGACY_SNIPPET_HEADING}" section differs from the v0.3.1 snippet, so it is yours — fold what you want into the marked block and delete the rest by hand` : undefined,
  };
}

function writeSnippet(ledger, file) {
  const existing = ledger.exists(file) ? ledger.read(file) : "";
  const { text, changed, how, note } = upsertSnippet(existing, snippetText());
  if (!changed) {
    ledger.kept.push(file);
    if (how.startsWith("refused")) ledger.notes.push(`${file}: ${how}`);
    return;
  }
  if (existing) ledger.overwrite(file, text);
  else if (!ledger.create(file, text)) return;
  ledger.notes.push(`${file}: ${how} the ZDD instruction block`);
  if (note) ledger.notes.push(`${file}: ${note}`);
}

// docs/agents/domain.md (CAS-93): Matt Pocock's skills (1.3+) read a root
// GLOSSARY.md and docs/adr/ by name, and the one redirect they honour is this
// file — what their setup skill writes — reached from a "See
// docs/agents/domain.md" line in CLAUDE.md (the ZDD block carries one). It is
// adopter-owned from the first byte: written only when absent, with the
// configured paths filled in, and never rewritten or edited — a hand-written
// one is kept, whatever it says.
export const DOMAIN_DOC = "docs/agents/domain.md";
export function domainDocText(paths) {
  return readFileSync(join(TEMPLATES, "domain.md"), "utf8")
    .replaceAll("<GLOSSARY>", paths.glossary)
    .replaceAll("<ADR_DIR>", paths.adrDir)
    .replaceAll("<ADR_INDEX>", paths.adrIndex);
}
function writeDomainDoc(ledger, paths) {
  if (ledger.exists(DOMAIN_DOC)) {
    ledger.kept.push(`${DOMAIN_DOC} (yours — never rewritten)`);
    return;
  }
  if (ledger.create(DOMAIN_DOC, domainDocText(paths))) {
    ledger.notes.push(`${DOMAIN_DOC}: written — points Matt Pocock's skills (1.3+, which read a root GLOSSARY.md and docs/adr/) at ${paths.glossary} and ${paths.adrDir}/; yours to edit from here`);
  }
}

// .claude/settings.json (CAS-93, decision 0014): ZDD brings in one pinned
// release of mattpocock-skills from its own marketplace, and Claude Code
// loads two enabled copies of one plugin name as ONE, silently — in the
// CAS-93 experiment the OTHER copy won. So the repo's committed project
// settings switch the other known copies off, in advance, and switch ZDD's
// pair on. Key-level merge into the adopter's file (every other key and its
// order kept; the analogue of the marked block in CLAUDE.md); never a user or
// local settings file, never an uninstall. A file that is not a JSON object
// is the adopter's problem to name, not ours to replace.
const SETTINGS_FILE = ".claude/settings.json";
// The lock (decision 0021, CAS-101): the marketplace declared at this
// release's tag, auto-update off — what the session-start release check reads.
// A declaration is OURS when its source is this marketplace's repository; any
// other (a fork, a mirror, a path) is the adopter's, named and never touched.
export const lockEntry = (version) => ({ source: { source: "github", repo: MARKETPLACE_REPO, ref: `v${version}` }, autoUpdate: false });
const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
export { MARKETPLACE, MARKETPLACE_REPO, isOurDeclaration };
const describeSource = (decl) => {
  const src = isPlainObject(decl?.source) ? decl.source : {};
  return String(src.repo ?? src.url ?? src.path ?? src.source ?? "an unknown source").slice(0, 120);
};

// The lock's half of the settings merge. mode "apply" writes the lock when
// absent and keeps an existing one; "upgrade" moves our lock's ref, and writes
// an absent one only on the user's word (`lock`, from `--lock`). Mutates `obj`;
// returns the ledger notes.
function mergeLock(obj, version, mode, lock) {
  const ekm = obj.extraKnownMarketplaces;
  const declared = isPlainObject(ekm) ? ekm[MARKETPLACE] : undefined;
  const tag = `v${version}`;
  if (ekm !== undefined && !isPlainObject(ekm)) {
    return [`${SETTINGS_FILE}: "extraKnownMarketplaces" is not an object, so this repo is NOT locked — left as it is (bootstrap never rewrites what it cannot read); make it an object and run again to lock it`];
  }
  if (declared !== undefined && !isOurDeclaration(declared)) {
    return [`${SETTINGS_FILE}: declares ${MARKETPLACE} from ${describeSource(declared)}, not this plugin's repository (${MARKETPLACE_REPO}) — yours, left as it is`];
  }
  if (declared === undefined) {
    if (mode === "upgrade" && !lock) {
      return [
        `${SETTINGS_FILE}: no lock — this repo floats on whatever ZDD each machine last fetched, and the release check stays silent. ` +
          `Lock it to ${tag} with \`bootstrap.mjs upgrade --lock\`, on the user's word (decision 0021)`,
      ];
    }
    obj.extraKnownMarketplaces = { ...(ekm ?? {}), [MARKETPLACE]: lockEntry(version) };
    return [
      `${SETTINGS_FILE}: locked this repo to ZDD ${tag} (extraKnownMarketplaces, auto-update off) — every developer runs this release, ` +
        `and moving to a new one is a deliberate PR the session-start release check announces`,
    ];
  }
  // Ours: a lock is only a lock with auto-update off (CR-006).
  const notes = [];
  let next = declared;
  if (declared.autoUpdate !== false) {
    next = { ...next, autoUpdate: false };
    notes.push(`${SETTINGS_FILE}: auto-update switched off on the zero-drift-docs declaration — a locked release moves only by a PR`);
  }
  const was = declared.source.ref;
  const shown = typeof was === "string" ? was.slice(0, 40) : "(no ref)";
  if (was !== tag && mode !== "upgrade") notes.push(`${SETTINGS_FILE}: locked to ${shown} — kept; moving the lock is upgrade's job`);
  else if (was !== tag) {
    next = { ...next, source: { ...next.source, ref: tag } };
    notes.push(
      `${SETTINGS_FILE}: lock moved ${shown} → ${tag}. After this PR merges, each developer's next session prints the route ` +
        `that moves their machine (restart, claude plugin update, restart)`,
    );
  }
  if (next !== declared) obj.extraKnownMarketplaces = { ...ekm, [MARKETPLACE]: next };
  return notes;
}

// The repo's lock ref when the declaration is ours, else null.
function ourLockRef(ledger) {
  if (!ledger.exists(SETTINGS_FILE)) return null;
  try {
    const d = JSON.parse(ledger.read(SETTINGS_FILE))?.extraKnownMarketplaces?.[MARKETPLACE];
    return isOurDeclaration(d) && typeof d.source.ref === "string" ? d.source.ref : null;
  } catch {
    return null;
  }
}

function writePluginSettings(ledger, version, { mode = "apply", lock = false } = {}) {
  const wanted = pluginSettings();
  const pin = pocockPin();
  let existing = "";
  let obj = {};
  if (ledger.exists(SETTINGS_FILE)) {
    existing = ledger.read(SETTINGS_FILE);
    try {
      obj = JSON.parse(existing);
    } catch {
      obj = null;
    }
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
      ledger.kept.push(SETTINGS_FILE);
      ledger.notes.push(`${SETTINGS_FILE}: not valid JSON (an object) — left untouched; add these by hand under "enabledPlugins": ${JSON.stringify(wanted)}`);
      return;
    }
  }
  const before = JSON.stringify(obj);
  const ep = obj.enabledPlugins;
  const enabled = ep && typeof ep === "object" && !Array.isArray(ep) ? ep : {};
  const pluginsMoved = Object.entries(wanted).some(([k, v]) => enabled[k] !== v);
  if (pluginsMoved) obj.enabledPlugins = { ...enabled, ...wanted }; // existing keys keep their place; ours are updated or appended
  const lockNotes = mergeLock(obj, version, mode, lock);
  if (JSON.stringify(obj) === before) {
    ledger.kept.push(SETTINGS_FILE);
    ledger.notes.push(...lockNotes);
    return;
  }
  let text = JSON.stringify(obj, null, 2) + "\n";
  if (/\r\n/.test(existing)) text = text.replace(/\n/g, "\r\n");
  if (existing) ledger.overwrite(SETTINGS_FILE, text);
  else if (!ledger.create(SETTINGS_FILE, text)) return;
  ledger.notes.push(...lockNotes);
  if (pluginsMoved) ledger.notes.push(
    `${SETTINGS_FILE}: switched off your other Pocock copies in this repo (${pin.otherCopies.join(", ")}) — each still works in your other repos — ` +
      `and switched on ${ZDD_PLUGIN_ID} and ${pin.plugin}@${pin.marketplace}, the ${pin.plugin} ${pin.version} release plugin ${version} is tested with. ` +
      `Only one copy of a plugin name loads per session, so this is what makes the pinned one load here. Claude Code reads this file; Codex ignores it`,
  );
}

function pinEngine(text, version) {
  const re = new RegExp(ENGINE_PACKAGE.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&") + "@[^\"'\\s]*", "g");
  return text.replace(re, `${ENGINE_PACKAGE}@${version}`);
}
// 2.0 (CAS-96): the workflow's lint step gates the merge, so it runs
// `lint --merge` — the pattern plan must be gone. An owned workflow is only
// re-pinned by upgrade, never rewritten, so the step is migrated in place: a
// `run:` line invoking the pinned engine's bare `lint` gains the flag. A
// workflow whose lint step has another shape is reported, not guessed at.
export function mergeGate(text) {
  const re = /^(\s*(?:-\s+)?run:\s*npx -y "\$ZDD_ENGINE" lint)[ \t]*(\r?)$/m;
  if (/\blint --merge\b/.test(text)) return { text, how: "present" };
  if (!re.test(text)) return { text, how: "absent" };
  return { text: text.replace(re, "$1 --merge$2"), how: "added" };
}
const workflowText = (version) => pinEngine(readFileSync(join(TEMPLATES, "zdd.yml"), "utf8"), version);
const prePushText = (version) => pinEngine(readFileSync(join(TEMPLATES, "pre-push"), "utf8"), version);

const hasGit = (root) => existsSync(join(root, ".git"));

// core.hooksPath: set it only when unset or already ours; an adopter's own
// hook manager (Husky, pre-commit, …) is never displaced (CR-007).
function ensureHooksPath(ledger) {
  if (!hasGit(ledger.root)) {
    ledger.notes.push("no .git here — after `git init`, run: git config core.hooksPath .githooks");
    return;
  }
  let current = "";
  try {
    current = execFileSync("git", ["config", "--get", "core.hooksPath"], { cwd: ledger.root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    current = "";
  }
  if (current && current !== ".githooks") {
    ledger.notes.push(`core.hooksPath is already ${current} (another hook manager) — left as is; call .githooks/pre-push from your existing pre-push hook`);
    return;
  }
  if (current === ".githooks") return;
  try {
    execFileSync("git", ["config", "core.hooksPath", ".githooks"], { cwd: ledger.root, stdio: "ignore" });
    ledger.notes.push("git config core.hooksPath .githooks (local config, not committed — each clone runs it once)");
  } catch {
    ledger.notes.push("could not run git config — set it yourself: git config core.hooksPath .githooks");
  }
}

// A plugin-owned file: created when missing; an existing file is kept, and
// one we do not own is called out (CR-006).
function ensureOwned(ledger, rel, content, opts) {
  if (!ledger.exists(rel)) return ledger.create(rel, content, opts);
  ledger.kept.push(rel);
  if (!isOwned(ledger.read(rel))) ledger.notes.push(`${rel}: exists and is not managed by zdd — left untouched; merge the template by hand (${posixify(relative(ledger.root, join(TEMPLATES, basename(rel) === "pre-push" ? "pre-push" : "zdd.yml")))})`);
  return false;
}

// ---------------------------------------------------------------------------
// apply
// ---------------------------------------------------------------------------
// Options merge (repair apply): objects deep, anything else replaced.
function mergeOptions(base, next) {
  if (!isPlainObject(base) || !isPlainObject(next)) return next;
  const out = { ...base };
  for (const [k, v] of Object.entries(next)) out[k] = mergeOptions(base[k], v);
  return out;
}

export function apply(root, rawAnswers, { date = today(), home } = {}) {
  const answers = validateAnswers(rawAnswers);
  const ledger = new Ledger(root);
  const version = pluginVersion();
  const cfg = readConfig(root);
  if (cfg.state === "invalid") throw new Error(`${cfg.error} — fix or remove it; bootstrap never replaces a config it cannot read`);
  const existingConfig = cfg.config;
  const paths = artifactPaths(existingConfig); // throws on a bad configured path — before any write
  const detection = detect(root);
  const mode = existingConfig ? "repair" : detection.mode;

  // Opt-ins: fresh adoption defaults all on; repair defaults to the current
  // state, so an omitted answer never reverses an earlier choice (CR-005).
  // Only a file the plugin OWNS counts as a current opt-in — an adopter's own
  // workflow or hook is not a ZDD choice to inherit or activate (CR-048).
  const owned = (rel) => ledger.exists(rel) && isOwned(ledger.read(rel));
  const current = existingConfig
    ? {
        autoLoad: existingConfig.hooks?.autoLoad ?? true,
        fence: existingConfig.hooks?.fence ?? false,
        stop: existingConfig.hooks?.stop ?? false,
        ci: owned(".github/workflows/zdd.yml"),
        prePush: owned(".githooks/pre-push"),
      }
    : { autoLoad: true, fence: true, stop: true, ci: true, prePush: true };
  const optIns = { ...current, ...(answers.optIns ?? {}) };

  // --- config.json -------------------------------------------------------
  let config = existingConfig;
  const stack = fromStack(answers.stack);
  if (!config) {
    let extractors = answers.extractors;
    let extractorOptions = answers.extractorOptions;
    if (!extractors?.length && stack.extractors.length) ({ extractors, extractorOptions } = stack);
    if (!extractors?.length) {
      extractors = detection.proposals.map((p) => p.name);
      extractorOptions = Object.fromEntries(detection.proposals.map((p) => [p.name, p.options]));
    }
    if (!extractors?.length) extractors = ["generic"];
    if (!extractorOptions) {
      extractorOptions = {};
      for (const name of extractors) {
        const found = detection.proposals.find((p) => p.name === name);
        extractorOptions[name] = found?.options ?? stack.extractorOptions[name] ?? {};
      }
    }
    config = {
      name: answers.name || basename(root),
      repoBase: answers.repoBase || "",
      baseBranch: answers.baseBranch || "main",
      engine: version,
      extractors,
      extractorOptions: Object.fromEntries(extractors.map((n) => [n, extractorOptions[n] ?? {}])),
      hooks: { autoLoad: optIns.autoLoad, fence: optIns.fence, stop: optIns.stop },
    };
    if (!hasGit(root)) config.render = { storeChanges: false };
    ledger.create("zdd/config.json", JSON.stringify(config, null, 2) + "\n");
  } else {
    // Repair: only an explicit answer changes the config. A pre-1.0 config's
    // extractors live under `adapter`; adding `extractors` beside it makes a
    // shape the engine refuses (CR-010), so upgrade migrates it first.
    if (existingConfig.adapter !== undefined && (answers.extractors?.length || answers.extractorOptions)) {
      throw new Error('zdd/config.json still uses the legacy "adapter" — run upgrade first (it migrates to "extractors"), then this answer');
    }
    const before = JSON.stringify(existingConfig);
    const repairNotes = [];
    if (
      optIns.autoLoad !== current.autoLoad ||
      optIns.fence !== current.fence ||
      optIns.stop !== current.stop ||
      // An explicit answer to a question the config has never recorded is a
      // change even when the effective value stays the same: a 1.0 config with
      // no `hooks.stop` answered "no" must say so, or --upgrade asks again
      // forever (CR-008).
      (answers.optIns && Object.hasOwn(answers.optIns, "stop") && typeof existingConfig.hooks?.stop !== "boolean")
    ) {
      // The hooks block is plugin-owned.
      existingConfig.hooks = { autoLoad: optIns.autoLoad, fence: optIns.fence, stop: optIns.stop };
      repairNotes.push("zdd/config.json: hooks block updated to the new answers");
    }
    // An opt-in extractor or a Realtime wrapper the upgrade confirmed with the
    // user (CAS-101): an explicit `extractors` answer is the list; explicit
    // `extractorOptions` merge into each extractor's options.
    if (answers.extractors?.length) {
      const was = Array.isArray(existingConfig.extractors) ? existingConfig.extractors : [];
      if (JSON.stringify(was) !== JSON.stringify(answers.extractors)) {
        existingConfig.extractors = answers.extractors;
        repairNotes.push(`zdd/config.json: extractors ${was.join(", ") || "(none)"} → ${answers.extractors.join(", ")}`);
      }
    }
    if (answers.extractorOptions) {
      const opts = isPlainObject(existingConfig.extractorOptions) ? existingConfig.extractorOptions : {};
      const moved = [];
      for (const [name, value] of Object.entries(answers.extractorOptions)) {
        const merged = mergeOptions(opts[name], value);
        if (JSON.stringify(merged) !== JSON.stringify(opts[name])) {
          opts[name] = merged;
          moved.push(name);
        }
      }
      if (moved.length) {
        existingConfig.extractorOptions = opts;
        repairNotes.push(`zdd/config.json: extractorOptions updated for ${moved.join(", ")}`);
      }
    }
    if (JSON.stringify(existingConfig) !== before) {
      ledger.overwrite("zdd/config.json", JSON.stringify(existingConfig, null, 2) + "\n");
      ledger.notes.push(...repairNotes);
    } else ledger.kept.push("zdd/config.json");
  }

  // --- curated skeleton (empty templates; never overwritten) ---------------
  ledger.create(paths.glossary, "# Glossary\n\n<!-- One paragraph per term: **Term**: definition. Canonical, not descriptive. -->\n");
  for (const sub of ["features", "apps", "services"]) {
    const dir = ledger.abs(`${paths.mapDir}/${sub}`);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
      ledger.create(`${paths.mapDir}/${sub}/.gitkeep`, "");
    }
  }
  const apps = answers.apps ?? (answers.stack ? stack.apps : detection.apps.map((a) => a.name));
  const slugs = dedupe(apps.map(slug)); // CR-013
  apps.forEach((app, i) => {
    ledger.create(
      `${paths.mapDir}/apps/${slugs[i]}.md`,
      `---\ntype: Application\ntitle: ${yamlScalar(app)}\ndescription: ${yamlScalar(`${app} — declared at bootstrap; fill in as the code lands.`)}\nresource: .\ntags: []\n---\n\n${app.replace(/[<>]/g, "")}: planned at adoption, before any code existed. Link its features here as they appear.\n`,
    );
  });
  // One example feature slice, so `features/` never sits as an unexplained
  // .gitkeep: it shows the shape (a feature CLAIMS records by linking them)
  // with example lines drawn from the configured extractors. Created only
  // when the folder holds no slice yet; the adopter renames or deletes it.
  // Fresh adoption only (CR-013): a repair `apply` (the documented way to
  // answer a new opt-in after --upgrade) never writes into an adopter's map.
  if (!existingConfig) {
    const featuresDir = ledger.abs(`${paths.mapDir}/features`);
    const hasSlice = readdirSync(featuresDir).some((f) => /\.md$/i.test(f));
    if (!hasSlice) ledger.create(`${paths.mapDir}/features/example-feature.md`, exampleFeature(config, paths));
    else ledger.kept.push(`${paths.mapDir}/features/ (a slice is present — example skipped)`);
  }
  const adrDir = ledger.abs(paths.adrDir);
  mkdirSync(adrDir, { recursive: true });
  const adrFiles = readdirSync(adrDir).filter((f) => /^\d{4}-.*\.md$/.test(f));
  if (answers.seedAdr !== false) {
    if (adrFiles.length) ledger.kept.push(`${paths.adrDir}/ (${adrFiles.length} ADR${adrFiles.length === 1 ? "" : "s"} present — seed skipped)`);
    else ledger.create(`${paths.adrDir}/0001-adopt-zero-drift-docs.md`, readFileSync(join(TEMPLATES, "adr-0001-adopt-zero-drift-docs.md"), "utf8").replace("<DATE>", date));
  } else ledger.skipped.push(`${paths.adrDir}/0001-adopt-zero-drift-docs.md (declined)`);
  mkdirSync(ledger.abs(paths.metadataDir), { recursive: true });

  // --- opt-ins ------------------------------------------------------------
  ledger.notes.push(`hooks: autoLoad ${optIns.autoLoad ? "on" : "off"}, fence ${optIns.fence ? "on" : "off"}, stop ${optIns.stop ? "on" : "off"} (recorded in zdd/config.json; the plugin's hooks.json reads it)`);

  if (optIns.ci) {
    ensureOwned(ledger, ".github/workflows/zdd.yml", workflowText(version));
    if (ledger.exists(".githooks/pre-push")) ledger.notes.push(".githooks/pre-push also present — with CI accepted it is redundant; remove it if you no longer want the local check");
    else ledger.skipped.push(".githooks/pre-push (CI accepted — not needed)");
  } else {
    if (ledger.exists(".github/workflows/zdd.yml")) ledger.notes.push(".github/workflows/zdd.yml is present although CI was declined — delete it to make the choice real");
    else ledger.skipped.push(".github/workflows/zdd.yml (CI declined)");
    if (optIns.prePush) {
      ensureOwned(ledger, ".githooks/pre-push", prePushText(version), { executable: true });
      // Point git at .githooks only when the hook there is ours (CR-006, CR-048).
      if (owned(".githooks/pre-push")) ensureHooksPath(ledger);
    } else ledger.skipped.push(".githooks/pre-push (declined)");
  }

  writeSnippet(ledger, "CLAUDE.md");
  if (answers.codex) writeSnippet(ledger, "AGENTS.md");
  else ledger.skipped.push("AGENTS.md (not using Codex)");
  writeDomainDoc(ledger, paths);
  writePluginSettings(ledger, version);

  const pocock = findPocock(root, home);
  return { mode, version, date, config, optIns, pocock, detection, ...ledgerOut(ledger) };
}

// The example feature slice's text, from the configured extractors. The
// example TARGETS are shown as bare paths, never in the `[x](y.json)` shape:
// the render's link scanner reads that shape wherever it appears (inline
// code included), and a link it cannot resolve blocks the render — and at
// bootstrap no metadata exists yet.
const EXAMPLE_TARGETS = {
  supabase: ["a table: `../../metadata/table/db--things.json`"],
  nextjs: ["an API route: `../../metadata/route/things.json`", "a page: `../../metadata/surface/things--_id.json`"],
  fastapi: ["an API route: `../../metadata/route/things--_id.json`"],
  "react-router": ["a screen: `../../metadata/surface/things--_id.json`"],
};
export function exampleFeature(config, paths) {
  // Relative to the slice's own folder, whatever the configured layout (CR-022).
  const toMeta = posixify(relative(join(paths.mapDir, "features"), paths.metadataDir)) || ".";
  const targets = [];
  for (const name of config.extractors ?? []) for (const t of EXAMPLE_TARGETS[name] ?? []) if (!targets.includes(t)) targets.push(t.replaceAll("../../metadata", toMeta));
  if (!targets.length) targets.push(`a record: \`${toMeta}/<kind>/<file>.json\``);
  const roots = [];
  for (const name of config.extractors ?? []) {
    const o = config.extractorOptions?.[name] ?? {};
    const candidates = [o.appDir, o.routesFile && posixify(dirname(o.routesFile)), ...(Array.isArray(o.roots) ? o.roots : []), ...(Array.isArray(o.migrationNamespaces) ? o.migrationNamespaces.map((m) => m?.dir) : [])];
    for (const r of candidates) if (typeof r === "string" && r && !roots.includes(r)) roots.push(r);
  }
  return [
    "---",
    "type: Feature",
    "title: Example feature",
    'description: "A worked example of a feature slice - rename it to a real feature, or delete it."',
    `resource: ${yamlScalar(roots[0] ?? ".")}`,
    "tags: [example]",
    "---",
    "",
    "A **feature slice** is one file here per user-facing capability. It says",
    "*where* the capability lives (`resource:`), *what connects* (links to the",
    "records `derive` inventoried - a feature CLAIMS a record by linking it, and",
    "`zdd-engine lint` lists every route, table, function and surface no slice",
    "claims), and *what to copy* (a `# Blessings` section: one line per",
    "pattern, opening with the question it answers - \"Adding an endpoint?\" -",
    "then the exemplar to copy, the pattern to refuse, and the reason: an ADR,",
    "or \"because ...\"). A unit of work that adds or changes user-facing",
    "behaviour adds a slice or extends one; \"choose patterns\" reads the",
    "blessings before the code is written.",
    "",
    "Claim a record with a markdown link, `[title](path)`, the path relative to",
    "this file - for this stack, for example:",
    "",
    ...targets.map((t) => `- ${t}`),
    "",
    "(Shown as bare paths: no metadata exists at bootstrap, and a link that does",
    "not resolve blocks `render`. Run `derive`, then link what it wrote.)",
    "",
  ].join("\n");
}

function ledgerOut(l) {
  return { wrote: l.wrote, kept: l.kept, skipped: l.skipped, notes: l.notes };
}

// ---------------------------------------------------------------------------
// upgrade
// ---------------------------------------------------------------------------
// The guided upgrade (CAS-101): `plan` writes nothing and says what would
// change; `drop` (ids from the plan's duplicates) removes adopter sections the
// block now covers, on the user's word; `to` (a tag newer than this plugin)
// moves only the lock — the rest waits for that release's own upgrade.
export function upgrade(root, { lock = false, plan = false, drop = null, to = null, remote } = {}) {
  const version = pluginVersion();
  if (to !== null) return moveLockOnly(root, version, to, { plan, lock, remote });
  const cfg = readConfig(root);
  if (cfg.state === "absent") throw new Error(`no zdd/config.json under ${root} — nothing to upgrade (run bootstrap without --upgrade to adopt)`);
  if (cfg.state === "invalid") throw new Error(`${cfg.error} — fix it by hand; upgrade never rewrites a config it cannot read`);
  // Never backwards (CR-005): a teammate may already have moved the repo past
  // the release this machine runs. The machine moves first.
  const locked = ourLockRef(new Ledger(root));
  if (locked && RELEASE_TAG.test(locked) && compareVersions(locked, version) > 0) {
    throw new Error(`this repo locks ${locked}, newer than this plugin (${version}) — update this machine first (the session-start line names the commands), restart, then say "upgrade ZDD" again`);
  }
  if (typeof cfg.config.engine === "string" && /^\d+\.\d+\.\d+$/.test(cfg.config.engine) && compareVersions(cfg.config.engine, version) > 0) {
    throw new Error(`zdd/config.json's engine pin ${cfg.config.engine} is newer than this plugin (${version}) — update this machine's plugin first; upgrade never moves a repo backwards`);
  }
  const dropIds = parseDrop(drop);
  if (dropIds.length && !plan) {
    const known = upgrade(root, { lock, plan: true }).duplicates.map((d) => d.id);
    const bad = dropIds.find((id) => !known.includes(id));
    if (bad !== undefined) throw new Error(`--drop: no duplicate ${bad} (this run names ${known.length ? known.join(", ") : "none"}) — run upgrade --plan for the list`);
  }
  const ledger = new Ledger(root, { dryRun: plan });
  const config = cfg.config;
  const fromEngine = typeof config.engine === "string" ? config.engine : null;
  const hasLegacy = config.adapter !== undefined || config.adapterOptions !== undefined;
  const hasNew = config.extractors !== undefined || config.extractorOptions !== undefined;
  if (hasLegacy && hasNew) throw new Error("zdd/config.json has both 'adapter' and 'extractors' — keep one by hand before upgrading (the engine refuses this shape too)"); // CR-008
  const before = JSON.stringify(config);
  const changes = [];

  if (config.adapter !== undefined) {
    const adapterName = config.adapter;
    const legacy = LEGACY_ADAPTERS[config.adapter];
    if (!legacy) throw new Error(`unknown legacy adapter '${config.adapter}' — migrate by hand to "extractors": [...]`);
    const split = legacy.split(config.adapterOptions);
    const next = {};
    // Keep the adopter's key order, with the new keys where the old ones sat.
    for (const [k, v] of Object.entries(config)) {
      if (k === "adapter") next.extractors = legacy.extractors;
      else if (k === "adapterOptions") next.extractorOptions = Object.fromEntries(legacy.extractors.map((n) => [n, split[n] ?? {}]));
      else next[k] = v;
    }
    if (!next.extractorOptions) next.extractorOptions = Object.fromEntries(legacy.extractors.map((n) => [n, split[n] ?? {}]));
    for (const k of Object.keys(config)) delete config[k];
    Object.assign(config, next);
    changes.push(`adapter "${adapterName}" → extractors ${JSON.stringify(next.extractors)}; adapterOptions split into extractorOptions`);
  }
  if (config.viewer && typeof config.viewer === "object" && Array.isArray(config.viewer.nonAreaTags)) {
    if (config.nonAreaTags === undefined) config.nonAreaTags = config.viewer.nonAreaTags;
    delete config.viewer.nonAreaTags;
    if (!Object.keys(config.viewer).length) delete config.viewer;
    changes.push("viewer.nonAreaTags → top-level nonAreaTags (it shapes graph.json, not just the viewer)");
  }
  if (config.engine !== version) {
    changes.push(`engine pin ${typeof config.engine === "string" ? config.engine : "(none)"} → ${version}`);
    config.engine = version;
  }
  // The Stop hook (plugin 1.1, decision 0008) is a new opt-in; upgrade names
  // it but never answers it — the skill asks, and a repair `apply` records it.
  const stopUnset = !(config.hooks && typeof config.hooks === "object" && !Array.isArray(config.hooks) && typeof config.hooks.stop === "boolean");
  if (JSON.stringify(config) !== before) {
    ledger.overwrite("zdd/config.json", JSON.stringify(config, null, 2) + "\n");
    for (const c of changes) ledger.notes.push(`zdd/config.json: ${c}`);
  } else ledger.kept.push("zdd/config.json");

  // Plugin-owned files: rewrite to this version, only where they exist AND
  // carry the ownership line. A file we do not own is reported, not edited.
  for (const [rel, fresh] of [
    [".github/workflows/zdd.yml", () => workflowText(version)],
    [".githooks/pre-push", () => prePushText(version)],
  ]) {
    if (!ledger.exists(rel)) continue;
    const cur = ledger.read(rel);
    if (!isOwned(cur)) {
      // The v0.3.1 template had no ownership line and no pin; the exact file
      // (modulo line endings / trailing whitespace) is still ours (CR-081).
      if (rel.endsWith("zdd.yml") && isLegacyWorkflow(cur)) {
        ledger.overwrite(rel, fresh());
        ledger.notes.push(`${rel}: the unmodified v0.3.1 workflow (unpinned npx, no ownership line) replaced with the pinned template (${version})`);
        continue;
      }
      ledger.kept.push(`${rel} (not managed by zdd — left untouched; check its engine pin by hand)`);
      continue;
    }
    let next = rel.endsWith("pre-push") ? fresh() : pinEngine(cur, version);
    let gate = null;
    if (rel.endsWith("zdd.yml")) {
      gate = mergeGate(next);
      next = gate.text;
      if (gate.how === "absent") {
        ledger.notes.push(`${rel}: no \`run: npx -y "$ZDD_ENGINE" lint\` step found — add --merge to your lint step by hand, so the merge gate fails while ${artifactPaths(config, { lenient: true }).patternsPlan} exists`);
      }
    }
    if (next !== cur) {
      ledger.overwrite(rel, next);
      ledger.notes.push(`${rel}: ${rel.endsWith("pre-push") ? "rewritten from the template" : "engine pin updated"} (${version})`);
      if (gate?.how === "added") ledger.notes.push(`${rel}: the lint step now runs \`lint --merge\` (2.0) — the merge gate fails while the branch's pattern plan exists`);
    } else ledger.kept.push(rel);
  }
  for (const file of ["CLAUDE.md", "AGENTS.md"]) {
    if (!ledger.exists(file)) continue;
    const cur = ledger.read(file);
    if (!cur.includes(SNIPPET_BEGIN) && !cur.includes(SNIPPET_END) && !cur.includes(LEGACY_SNIPPET_HEADING)) {
      ledger.kept.push(`${file} (no ZDD block to refresh)`);
      continue;
    }
    writeSnippet(ledger, file);
  }
  // Adopter text outside the block that the block now covers (CAS-101):
  // named with its lines, removed only by --drop, after the block refresh so
  // the plan's line numbers are the real run's.
  let duplicates = findAllDuplicates(ledger);
  if (dropIds.length && !plan) {
    dropSections(ledger, duplicates.filter((d) => dropIds.includes(d.id)));
    duplicates = findAllDuplicates(ledger);
  }
  writeDomainDoc(ledger, artifactPaths(config, { lenient: true }));
  writePluginSettings(ledger, version, { mode: "upgrade", lock });
  if (stopUnset) ledger.notes.push('hooks.stop is not set (new in 1.1: the Stop hook prompts for the curated half once per session) — it stays OFF until answered: run bootstrap apply with {"optIns":{"stop":true}} (repair mode, keeps every other choice), or add "stop": true inside the existing "hooks" object by hand');
  const ctx = { root, config, version, paths: artifactPaths(config, { lenient: true }) };
  for (const [release, notes] of Object.entries(UPGRADE_NOTES)) {
    if (fromEngine && compareVersions(release, fromEngine) <= 0) continue;
    // A note never stops an upgrade mid-write (CR-011): a config shape it
    // did not expect is named, and the run goes on.
    try {
      ledger.notes.push(...notes(ctx));
    } catch {
      ledger.notes.push(`${release}: this release's note could not read zdd/config.json's shape — see the upgrade skill's "Upgrading to" section for it`);
    }
  }
  ledger.notes.push("curated artifacts (glossary, ADRs, map, metadata) untouched — upgrade never writes them");
  ledger.notes.push("if the engine pin moved: run `derive` and `render`, then `lint`, and commit the regenerated artifacts in the same PR");
  return { version, plan, ...ledgerOut(ledger), duplicates };
}

// ---------------------------------------------------------------------------
// What each release brings an existing adopter (CAS-101): one entry per
// release an upgrade crosses, said only when the repo's engine pin is older.
// Every minor has an entry — a test fails a release without one, and the
// `upgrade` skill carries a matching "Upgrading to X.Y" section. Each note
// opens with its release so the narration reads as a changelog.
// ---------------------------------------------------------------------------
const OPT_IN_EXTRACTORS = ["components", "expo-router", "jobs", "services"];
export const UPGRADE_NOTES = {
  "1.1.0": ({ version }) => [
    "1.1 adds a blocking lint (a blessing citing a superseded or missing ADR fails `lint`) — run `npx -y " + ENGINE_PACKAGE + "@" + version + " lint` before pushing; a red result is the lint doing its job on a stale blessing",
  ],
  "1.2.0": () => [
    "1.2 adds the `react-router` extractor (detection offers it), a lint warning listing unclaimed records (never a failure), and their count in the human index header — the human index re-renders on the bump",
  ],
  "1.3.0": ({ config }) => [
    "1.3 adds the `extractor` skill: it scaffolds a local extractor for a stack ZDD does not read yet",
    ...(config.claims === undefined
      ? [
          '1.3 adds claims.strict: lint can enforce "every record belongs to exactly one feature slice" — an unclaimed record not on an allow-list, a stale allow-list entry, or a record two slices claim then FAILS. It is off until you add it to zdd/config.json: "claims": { "strict": true, "allowUnclaimed": ["route:/health"] }. Without it, double claims are a warning beside the unclaimed list',
        ]
      : []),
  ],
  "1.3.1": () => ["1.3.1 fixes the ADR index link cut — render bytes change only where an index line was cut inside a link"],
  "2.0.0": ({ paths }) => [
    `2.0 adds "choose patterns" (skill: patterns) and a fifth generated artifact, ${paths.blessingIndex} — run \`render\` and commit it in this PR, or render --check fails`,
    '2.0 makes a blessing that does not open with its trigger question ("Adding an endpoint? …") FAIL lint — run `lint` and show the developer every blessing it names; upgrade never rewrites the map, so add each question on their word',
  ],
  "2.1.0": ({ root, config }) => {
    const notes = [];
    const have = new Set(Array.isArray(config.extractors) ? config.extractors : []);
    let proposals = [];
    try {
      proposals = detect(root).proposals ?? [];
    } catch {
      notes.push("2.1 could not re-run detection here — run `bootstrap.mjs detect` to see whether the opt-in extractors (components, expo-router, jobs, services) apply");
    }
    for (const p of proposals) {
      if (!OPT_IN_EXTRACTORS.includes(p.name) || have.has(p.name)) continue;
      notes.push(
        `2.1 offers the opt-in extractor \`${p.name}\` — evidence: ${(p.evidence ?? []).join("; ")}. ` +
          `Never added by upgrade: on the user's word, a repair apply with it in "extractors" (and its options: ${JSON.stringify(p.options ?? {})})`,
      );
    }
    // Per web extractor (CR-009); a malformed list counts as unnamed (CR-011).
    const opts = isPlainObject(config.extractorOptions) ? config.extractorOptions : {};
    const named = { "react-router": opts["react-router"]?.subscribeCalls, nextjs: opts.nextjs?.refs?.subscribeCalls };
    const unnamed = have.has("supabase") ? ["react-router", "nextjs"].filter((w) => have.has(w) && !(isCallList(named[w]) && named[w].length)) : [];
    if (unnamed.length) {
      notes.push(
        '2.1 maps realtime subscriptions as `subscribes` edges: the Supabase client\'s own `.on("postgres_changes", { table })` needs nothing, but a wrapper (e.g. `live.onInsert("table", …)`) is invisible until named — ask whether the app has one, and record it in ' +
          unnamed.map((w) => SUBSCRIBE_CALLS[w]).join(" / "),
      );
    }
    if (config.claims?.strict === true && config.claims.strictKinds === undefined) {
      notes.push("2.1 adds claims.strictKinds: strict governs the new kinds (component, job, service) only where listed, so switching an opt-in extractor on never turns lint red by itself (decision 0017)");
    }
    notes.push(
      "2.1 corrects a `*` in a scanned url: it no longer matches a fixed route segment (`/health`), so refs drop wherever a wildcard had reached one — expect a `derive --check` diff on the pin bump, and lint names the calls it could not place",
    );
    return notes;
  },
  "2.1.1": () => [
    "2.1.1 moves bytes wherever a fix applies — schema-qualified tables (`public.x`) gain their edges and trigger facts, component descriptions come from the comment attached to the component, an External services list links `.json` — so re-derive and re-render on the bump",
  ],
  "2.2.0": () => [
    '2.2 locks the repo to its ZDD release (decision 0021) and adds a spoken verb, "upgrade ZDD" (skill: upgrade) — this guided flow. The instruction block gains the rules every adopter needs: a release or skew line is the first line of the reply; generated-file conflicts are merged, committed, then regenerated, never hand-resolved; "update ZDD" is never delegated; a developer joining the repo installs zdd for this project',
    "2.2 next step for the team: after this PR merges, each developer's next session start prints one line naming the exact commands that move their machine to this release — run them, then restart",
  ],
};

export function compareVersions(a, b) {
  const pa = String(a).replace(/^v/, "").split(/[.-]/).map(Number);
  const pb = String(b).replace(/^v/, "").split(/[.-]/).map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
}

// ---------------------------------------------------------------------------
// Duplicates outside the managed block (CAS-101). A markdown section — its
// heading down to the next heading of the same or a higher level — is named
// when its own text (heading and the lines before its first child) speaks of
// ZDD, and every child section is named too: a section that also carries
// unrelated subsections is never named whole. Lines inside the managed block
// and inside fenced code are not read. Line numbers are 1-based, inclusive.
// ---------------------------------------------------------------------------
// A section speaks of ZDD when its heading does, when it uses a spoken verb,
// or when it mentions ZDD at least twice — one passing mention ("the ZDD
// check runs in CI", a title's "smoke-test the ZDD plugin") is not a rule the
// block duplicates (found by the CAS-101 smoke). The document's title (its
// first heading, at level 1) is never named.
const ZDD_VERB = /\b(?:load|update|upgrade) ZDD\b|choose patterns/i;
const ZDD_MENTION = /\bZDD\b|zero[- ]drift|\bzdd\/|zdd-engine|agent-index|blessing-index/gi;
const talksZdd = (heading, own) => new RegExp(ZDD_MENTION.source, "i").test(heading) || ZDD_VERB.test(own) || (own.match(ZDD_MENTION) ?? []).length >= 2;
export function findDuplicates(text) {
  const lines = text.split(/\r?\n/);
  // Only beside exactly one well-formed block (CR-002): with no block nothing
  // covers the section, and with a lone, doubled or reversed marker the
  // refresh is refused, so the block cannot be said to carry anything.
  if (text.split(SNIPPET_BEGIN).length !== 2 || text.split(SNIPPET_END).length !== 2) return [];
  const b = lines.findIndex((l) => l.trimEnd() === SNIPPET_BEGIN);
  const e = lines.findIndex((l) => l.trimEnd() === SNIPPET_END);
  if (b === -1 || e === -1 || b > e) return [];
  let fence = false;
  const heads = [];
  lines.forEach((l, i) => {
    if (b !== -1 && e !== -1 && i >= b && i <= e) return;
    if (/^\s*(```|~~~)/.test(l)) fence = !fence;
    const m = !fence && /^(#{1,6})\s+\S/.exec(l);
    if (m) heads.push({ i, level: m[1].length });
  });
  const blank = (i) => b !== -1 && e !== -1 && i >= b && i <= e;
  const sections = heads.map((h, k) => {
    const nextAny = k + 1 < heads.length ? heads[k + 1].i : lines.length;
    const after = heads.slice(k + 1).find((x) => x.level <= h.level);
    let end = after ? after.i : lines.length;
    // A span never swallows the managed block: it stops where the block starts.
    if (b !== -1 && b > h.i && b < end) end = b;
    const own = lines.slice(h.i, nextAny).filter((_, j) => !blank(h.i + j)).join("\n");
    const children = heads.slice(k + 1).filter((x) => x.i < end && x.level > h.level && heads.slice(k + 1).find((y) => y.i < x.i && y.level < x.level && y.level > h.level) === undefined);
    const title = k === 0 && h.level === 1;
    return { ...h, end, talks: !title && talksZdd(lines[h.i], own), children: children.map((c) => c.i) };
  });
  const byLine = new Map(sections.map((s) => [s.i, s]));
  const named = (s) => s.talks && s.children.every((c) => named(byLine.get(c)));
  const out = [];
  const covered = (i) => out.some((d) => i >= d.from - 1 && i < d.to);
  for (const s of sections) {
    if (covered(s.i) || !named(s)) continue;
    out.push({ heading: lines[s.i].trim(), from: s.i + 1, to: s.end });
  }
  return out;
}
// A duplicate's id is a hash of its file and its exact text (CR-014): the
// user approves a section as the plan showed it, and a section edited since —
// or a different one now at that position — no longer answers to the id.
function findAllDuplicates(ledger) {
  const all = [];
  for (const file of ["CLAUDE.md", "AGENTS.md"]) {
    if (!ledger.exists(file)) continue;
    const text = ledger.read(file);
    const lines = text.split(/\r?\n/);
    for (const d of findDuplicates(text)) {
      const id = createHash("sha256").update(`${file}\0${lines.slice(d.from - 1, d.to).join("\n")}`).digest("hex").slice(0, 8);
      all.push({ id, file, ...d });
    }
  }
  return all;
}
function dropSections(ledger, chosen) {
  for (const file of new Set(chosen.map((d) => d.file))) {
    const text = ledger.read(file);
    const eol = /\r\n/.test(text) ? "\r\n" : "\n";
    const lines = text.split(/\r?\n/);
    const mine = chosen.filter((d) => d.file === file).sort((x, y) => y.from - x.from);
    for (const d of mine) lines.splice(d.from - 1, d.to - d.from + 1);
    ledger.overwrite(file, lines.join(eol));
    for (const d of mine.reverse()) ledger.notes.push(`${file}: removed "${d.heading}" (lines ${d.from}–${d.to}), on the user's word — the ZDD block now carries it`);
  }
}
function parseDrop(drop) {
  if (drop === null || drop === undefined || drop === false) return [];
  const ids = String(drop).split(",").map((s) => s.trim().toLowerCase());
  if (!ids.every((s) => /^[0-9a-f]{8}$/.test(s))) throw new Error("--drop takes the ids upgrade --plan printed (8 hex characters each, comma-separated)");
  return [...new Set(ids)];
}

// ---------------------------------------------------------------------------
// A newer release than the running plugin (CAS-101). `release-status` finds
// the newest release tag on the marketplace's repository; `upgrade --to`
// moves only our lock to it. Claude Code loads a new plugin version only at
// start, so the rest of the upgrade is that release's own run, after the
// restart and the update the session-start line names.
// ---------------------------------------------------------------------------
const RELEASE_TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
export function newestTag(lsRemote) {
  let best = null;
  for (const line of String(lsRemote).split(/\r?\n/)) {
    const m = /\trefs\/tags\/(\S+)$/.exec(line);
    if (!m || !RELEASE_TAG.test(m[1])) continue;
    if (!best || compareVersions(m[1], best) > 0) best = m[1];
  }
  return best;
}
export function releaseStatus(root, remote = `https://github.com/${MARKETPLACE_REPO}.git`) {
  const running = pluginVersion();
  let lock = null;
  try {
    const s = JSON.parse(readFileSync(join(root, SETTINGS_FILE), "utf8"));
    const d = s?.extraKnownMarketplaces?.[MARKETPLACE];
    if (isOurDeclaration(d) && typeof d.source.ref === "string") lock = d.source.ref;
  } catch {
    /* no settings: no lock */
  }
  const out = remoteTags(remote);
  const newest = newestTag(out);
  return { lock, running, newest, newer: newest !== null && compareVersions(newest, running) > 0 };
}
function remoteTags(remote = `https://github.com/${MARKETPLACE_REPO}.git`) {
  return execFileSync("git", ["ls-remote", "--tags", "--refs", remote], { encoding: "utf8", timeout: 30000, stdio: ["ignore", "pipe", "pipe"] });
}
// Every --to is lock-only (CR-004): the target must be a release tag the
// marketplace's repository has (CR-003), never below this plugin or the
// repo's current lock; an absent lock is written only with --lock (CR-008);
// --plan writes nothing.
function moveLockOnly(root, version, to, { plan = false, lock = false, remote } = {}) {
  if (!RELEASE_TAG.test(String(to))) throw new Error("--to must be a release tag, vX.Y.Z");
  if (compareVersions(to, version) < 0) throw new Error(`--to ${to} is older than this plugin (${version}) — upgrade never moves a lock backwards`);
  const ledger = new Ledger(root, { dryRun: plan });
  let obj = {};
  let existing = "";
  if (ledger.exists(SETTINGS_FILE)) {
    existing = ledger.read(SETTINGS_FILE);
    try {
      obj = JSON.parse(existing);
    } catch {
      throw new Error(`${SETTINGS_FILE} is not valid JSON — fix it by hand`);
    }
    if (!isPlainObject(obj)) throw new Error(`${SETTINGS_FILE} is not a JSON object — fix it by hand`);
  }
  const ekm = obj.extraKnownMarketplaces;
  if (ekm !== undefined && !isPlainObject(ekm)) throw new Error(`${SETTINGS_FILE}: "extraKnownMarketplaces" is not an object — fix it by hand`);
  const d = ekm?.[MARKETPLACE];
  if (d === undefined && !lock) throw new Error(`no lock in ${SETTINGS_FILE} — add --lock to lock this repo at ${to} (on the user's word; decision 0021)`);
  if (d !== undefined && !isOurDeclaration(d)) throw new Error(`${SETTINGS_FILE} declares ${MARKETPLACE} from ${describeSource(d)}, not this plugin's repository — move it by hand`);
  const was = d === undefined ? null : typeof d.source.ref === "string" ? d.source.ref : null;
  if (was && RELEASE_TAG.test(was) && compareVersions(to, was) < 0) throw new Error(`--to ${to} is older than this repo's lock (${was}) — upgrade never moves a lock backwards`);
  let tags;
  try {
    tags = remoteTags(remote);
  } catch {
    throw new Error(`could not read the release tags from ${remote ?? MARKETPLACE_REPO} — check the network and try again; the lock is unchanged`);
  }
  if (!String(tags).split(/\r?\n/).some((l) => l.endsWith(`refs/tags/${to}`))) throw new Error(`${to} is not a release tag on ${remote ?? MARKETPLACE_REPO} — use the tag release-status printed`);

  const next = d === undefined ? lockEntry(to.slice(1)) : { ...d, source: { ...d.source, ref: to }, autoUpdate: false };
  if (JSON.stringify(next) === JSON.stringify(d)) {
    ledger.kept.push(SETTINGS_FILE);
  } else {
    obj.extraKnownMarketplaces = { ...(ekm ?? {}), [MARKETPLACE]: next };
    let text = JSON.stringify(obj, null, 2) + "\n";
    if (/\r\n/.test(existing)) text = text.replace(/\n/g, "\r\n");
    ledger.overwrite(SETTINGS_FILE, text);
    ledger.notes.push(`${SETTINGS_FILE}: ${was ? `lock moved ${was.slice(0, 40)} → ${to}` : `locked this repo to ZDD ${to}`} (auto-update off) — nothing else changes in this run`);
  }
  ledger.notes.push(
    `next: restart Claude Code; the first line of the new session names the commands that move this machine to ${to} — run them and restart again; then say "upgrade ZDD" again: that run is ${to}'s own, and shows the rest of the changes before writing them`,
  );
  return { version, plan, to, ...ledgerOut(ledger), duplicates: [] };
}

// ---------------------------------------------------------------------------
// Narration. Every line is one ledger entry; evidence and paths inside it come
// from the checkout (directory names, config values), which on POSIX may hold
// a newline or an ANSI escape. The skill reads this output, so a control
// character is replaced before it can forge a line or restyle the terminal
// (CR-092). `--json` output is JSON-quoted and needs no such step.
// ---------------------------------------------------------------------------
export const printable = (line) => line.replace(/[\x00-\x1f\x7f]/g, "?");

export function narrateDetect(d, pocock) {
  const out = [];
  if (d.mode === "greenfield") {
    out.push("Mode: GREENFIELD — no source to read. Ask for the intended stack and configure extractors ahead of the code.");
  } else {
    out.push(`Mode: EXISTING codebase (${d.sourceFiles} source files). Proposed extractors, with the evidence:`);
    for (const p of d.proposals) {
      out.push(`  - ${p.name}`);
      for (const e of p.evidence) out.push(`      evidence: ${e}`);
      out.push(`      options:  ${JSON.stringify(p.options)}`);
    }
    for (const a of d.apps) out.push(`  - map only: ${a.name} — ${a.evidence}; extractor ${a.extractor}`);
    for (const q of d.questions ?? []) out.push(`  ask: ${q.ask} (recorded under ${q.records})`);
  }
  out.push(narratePocock(pocock));
  return out.map(printable).join("\n");
}

function narratePocock(p) {
  const pin = pocockPin();
  if (p.installed) return `mattpocock-skills: installed (${p.hits[0].where}: ${p.hits[0].path}) — \`grill\` will run the real interview. ZDD pins ${pin.plugin} ${pin.version} (${pin.plugin}@${pin.marketplace}); this repo's .claude/settings.json keeps any other copy off here.`;
  return (
    `mattpocock-skills: NOT installed. Installing zdd brings it: \`/plugin install ${ZDD_PLUGIN_ID}\` (Claude Code) installs ${pin.plugin}@${pin.marketplace}, ` +
    `the ${pin.version} release this ZDD release is tested with, beside it — so a missing copy means zdd was loaded another way (a --plugin-dir, a copied folder); run that install. ` +
    "Your glossary and ADRs will only be as good as the design sessions that fill them, and `grill` (the design interview that writes them as it goes) needs Matt Pocock's skills. " +
    "Without it, work decisions out in plan mode and let \"update ZDD\" capture them."
  );
}

export function narrateApply(r) {
  const out = [`Bootstrap (${r.mode}) — plugin ${r.version}, ${r.date}`];
  for (const f of r.wrote) out.push(`  wrote   ${f}`);
  for (const f of r.kept) out.push(`  kept    ${f}`);
  for (const f of r.skipped) out.push(`  skipped ${f}`);
  for (const n of r.notes) out.push(`  note    ${n}`);
  out.push("");
  out.push("Next, run the engine (the skill does this): derive, then the mapping session, then render.");
  out.push(`  npx -y ${ENGINE_PACKAGE}@${r.version} derive`);
  out.push(`  npx -y ${ENGINE_PACKAGE}@${r.version} render`);
  out.push("");
  if (r.optIns.ci) {
    out.push("One step only you can do: in branch protection, require the `zdd` check to pass and require branches to be up to date before merging. Now stale generated artifacts cannot merge.");
  } else {
    out.push(
      "CI declined: ZDD runs on the two verbs alone" +
        (r.optIns.prePush ? ", with the pre-push hook making a forgotten update loud" : "") +
        ". The guarantee is weaker without CI — drift is a habit you keep, not a check that blocks a merge.",
    );
  }
  out.push(narratePocock(r.pocock));
  return out.map(printable).join("\n");
}

export function narrateUpgrade(r) {
  const title = r.to ? `Lock move to ${r.to}` : `Upgrade to plugin ${r.version}`;
  const out = [r.plan ? `${r.to ? `Lock move plan to ${r.to}` : `Upgrade plan for plugin ${r.version}`} — nothing written yet` : title];
  const verb = r.plan ? "would change" : "changed";
  if (!r.wrote.length) out.push("  nothing to change — every plugin-owned file is already at this version");
  for (const f of r.wrote) out.push(`  ${verb} ${f}`);
  for (const f of r.kept) out.push(`  kept    ${f}`);
  for (const n of r.notes) out.push(`  note    ${n}`);
  for (const d of r.duplicates ?? []) {
    out.push(`  outside the ZDD block: [${d.id}] ${d.file} lines ${d.from}–${d.to} "${d.heading}" — read it against the block; remove it only on the user's word (--drop=${d.id})`);
  }
  return out.map(printable).join("\n");
}

export function narrateReleaseStatus(s) {
  if (!s.newest) return "No ZDD release tag found on the marketplace's repository.";
  const lock = s.lock ? `this repo locks ${s.lock}` : "this repo has no lock";
  if (s.newer) return `ZDD ${s.newest} is out; ${lock} and this session runs ${s.running}. Release notes: https://github.com/${MARKETPLACE_REPO}/releases/tag/${s.newest}`;
  return `ZDD ${s.running} is the newest release; ${lock}.`;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
if (process.argv[1] && posixify(process.argv[1]).endsWith("/scripts/bootstrap.mjs")) {
  const { flags, positional } = parseArgs(process.argv.slice(2));
  const cmd = positional[0];
  const root = adopterRoot(flags);
  try {
    if (cmd === "detect") {
      const d = detect(root);
      const pocock = findPocock(root, flags.home);
      process.stdout.write(flags.json ? JSON.stringify({ ...d, pocock }, null, 2) + "\n" : narrateDetect(d, pocock) + "\n");
    } else if (cmd === "apply") {
      if (!flags.answers) throw new Error("apply needs --answers=<file.json>");
      const answers = readJson(flags.answers);
      if (flags.date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(String(flags.date))) throw new Error("--date must be YYYY-MM-DD");
      const r = apply(root, answers, { date: flags.date || today(), home: flags.home });
      process.stdout.write(flags.json ? JSON.stringify(r, null, 2) + "\n" : narrateApply(r) + "\n");
    } else if (cmd === "upgrade") {
      const to = flags.to === undefined ? null : String(flags.to);
      const remote = typeof flags.remote === "string" ? flags.remote : undefined;
      const r = upgrade(root, { lock: flags.lock === true, plan: flags.plan === true, drop: flags.drop ?? null, to, remote });
      process.stdout.write(flags.json ? JSON.stringify(r, null, 2) + "\n" : narrateUpgrade(r) + "\n");
    } else if (cmd === "release-status") {
      const s = releaseStatus(root, typeof flags.remote === "string" ? flags.remote : undefined);
      process.stdout.write(flags.json ? JSON.stringify(s) + "\n" : printable(narrateReleaseStatus(s)) + "\n");
    } else {
      process.stderr.write("Usage: bootstrap.mjs <detect|apply --answers=<file>|upgrade [--plan] [--lock] [--drop=<ids>] [--to=vX.Y.Z]|release-status [--remote=<url>]> [--root=<dir>] [--date=YYYY-MM-DD] [--home=<dir>] [--json]\n");
      process.exit(2);
    }
  } catch (e) {
    process.stderr.write(`bootstrap: ${e.message}\n`);
    process.exit(1);
  }
}
