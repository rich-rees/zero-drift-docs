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
//   bootstrap.mjs upgrade [--root=<dir>] [--json]
//       The only later writer into an adopter's repo. Migrates `adapter` →
//       `extractors`, moves `viewer.nonAreaTags` to the top level, rewrites
//       every plugin-OWNED file (engine pins, the managed hook, the marked
//       snippet blocks) to this plugin's version, and names every file it
//       changed. Never touches a curated artifact or a file it does not own.
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
//     "optIns": { "autoLoad": true, "fence": true, "ci": true, "prePush": true },   // defaults: all on (repair: current state)
//     "codex": false,                                  // also write AGENTS.md
//     "seedAdr": true                                  // ADR-0001 "Adopt Zero-Drift Docs"
//   }

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, lstatSync, chmodSync, openSync, writeSync, closeSync } from "node:fs";
import { join, dirname, basename, relative } from "node:path";
import { execFileSync } from "node:child_process";
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
} from "./lib/repo.mjs";

const TEMPLATES = join(PLUGIN_ROOT, "templates");
const SNIPPET_BEGIN = "<!-- zdd:begin -->";
const SNIPPET_END = "<!-- zdd:end -->";
const LEGACY_SNIPPET_HEADING = "## Documentation — Zero-Drift Docs (ZDD)";
// The v0.3.1 snippet's fingerprint: the section must carry BOTH of these
// bullets to be recognised as ours (CR-011). Anything else under that heading
// is the adopter's and is left alone.
const LEGACY_FINGERPRINT = ["/zdd:orient", "/zdd:update"];
// Ownership line carried by every file the plugin writes besides config.
export const OWNER_MARK = "Managed by Zero-Drift Docs (zdd)";
const SKIP_DIRS = new Set(["node_modules", ".git", ".next", "dist", "build", "coverage", ".venv", "venv", "__pycache__", ".expo", "zdd"]);
const MAX_NAME = 120;

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
      } else if (st.isFile()) onFile(p, name, posixify(relative(root, p)));
    }
  };
  rec(root, 0);
}

function readPackageJson(root) {
  const p = join(root, "package.json");
  try {
    if (!lstatSync(p).isFile()) return null;
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
  let sourceFiles = 0;

  walk(root, (abs, name, rel) => {
    if (/\.(ts|tsx|js|jsx|py|sql|go|rb|rs|java|cs)$/.test(name)) sourceFiles++;
    if (name.endsWith(".sql") && /(^|\/)migrations\//.test(rel + "/")) {
      const dir = posixify(dirname(rel));
      sqlDirs.set(dir, (sqlDirs.get(dir) ?? 0) + 1);
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
  });

  const pkg = readPackageJson(root);
  const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) };
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

  const apps = [];
  if (deps.expo || deps["expo-router"]) apps.push({ name: "Mobile (Expo)", evidence: "`expo` in package.json", extractor: "expo-router (not yet shipped — the map carries the surfaces)" });
  if (deps["react-router"] || deps["react-router-dom"]) apps.push({ name: "Web (React)", evidence: "`react-router` in package.json", extractor: "react-router (not yet shipped — the map carries the surfaces)" });

  const mode = sourceFiles === 0 && !pkg ? "greenfield" : "existing";
  if (mode === "existing" && !proposals.length) {
    proposals.push({ name: "generic", evidence: ["source present but no known convention found — map-only ZDD; add extractors later"], options: {} });
  }
  return { mode, proposals, apps, sourceFiles };
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
  { match: /expo|react.?native/i, app: "Mobile (Expo)" },
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
    } else apps.push(rule.app);
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
function validateExtractorOptions(all) {
  const obj = (v) => v && typeof v === "object" && !Array.isArray(v);
  const list = (v, label) => {
    if (!Array.isArray(v)) fail(`${label} must be an array of repo-relative paths`);
    v.forEach((p, i) => enginePath(p, `${label}[${i}]`));
  };
  for (const [name, opts] of Object.entries(all)) {
    if (!obj(opts)) fail(`extractorOptions.${name} must be an object`);
    if (name === "nextjs") {
      for (const k of ["appDir", "middlewarePath", "srcAliasRoot"]) if (opts[k] !== undefined) enginePath(opts[k], `nextjs.${k}`);
      if (opts.refs !== undefined) {
        if (!obj(opts.refs)) fail("nextjs.refs must be an object");
        if (opts.refs.roots !== undefined) list(opts.refs.roots, "nextjs.refs.roots");
      }
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
      if (!["autoLoad", "fence", "ci", "prePush"].includes(k)) fail(`optIns.${k} is not an opt-in`);
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
class Ledger {
  constructor(root) {
    this.root = root;
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
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
    this.wrote.push(rel);
  }
  create(rel, content, { executable = false } = {}) {
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
    try {
      return lstatSync(this.abs(rel)).isFile();
    } catch {
      return false;
    }
  }
  read(rel) {
    return readFileSync(this.abs(rel), "utf8");
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
  if (h !== -1) {
    const after = existing.indexOf("\n## ", h + LEGACY_SNIPPET_HEADING.length);
    const end = after === -1 ? existing.length : after + 1;
    const section = existing.slice(h, end);
    if (LEGACY_FINGERPRINT.every((f) => section.includes(f))) {
      const next = existing.slice(0, h) + body + existing.slice(end);
      return { text: next, changed: true, how: "replaced the pre-0.4 snippet" };
    }
    // The heading is there but the content is not ours: leave it, append.
  }
  const sep = existing.endsWith("\n") ? (/\r?\n\r?\n$/.test(existing) ? "" : norm("\n")) : norm("\n\n");
  return { text: existing + sep + body, changed: true, how: "appended" };
}

function writeSnippet(ledger, file) {
  const existing = ledger.exists(file) ? ledger.read(file) : "";
  const { text, changed, how } = upsertSnippet(existing, snippetText());
  if (!changed) {
    ledger.kept.push(file);
    if (how.startsWith("refused")) ledger.notes.push(`${file}: ${how}`);
    return;
  }
  if (existing) ledger.overwrite(file, text);
  else if (!ledger.create(file, text)) return;
  ledger.notes.push(`${file}: ${how} the ZDD instruction block`);
}

function pinEngine(text, version) {
  const re = new RegExp(ENGINE_PACKAGE.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&") + "@[^\"'\\s]*", "g");
  return text.replace(re, `${ENGINE_PACKAGE}@${version}`);
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
        ci: owned(".github/workflows/zdd.yml"),
        prePush: owned(".githooks/pre-push"),
      }
    : { autoLoad: true, fence: true, ci: true, prePush: true };
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
      hooks: { autoLoad: optIns.autoLoad, fence: optIns.fence },
    };
    if (!hasGit(root)) config.render = { storeChanges: false };
    ledger.create("zdd/config.json", JSON.stringify(config, null, 2) + "\n");
  } else if (optIns.autoLoad !== current.autoLoad || optIns.fence !== current.fence) {
    // Repair with an explicit new answer: the hooks block is plugin-owned.
    existingConfig.hooks = { autoLoad: optIns.autoLoad, fence: optIns.fence };
    ledger.overwrite("zdd/config.json", JSON.stringify(existingConfig, null, 2) + "\n");
    ledger.notes.push("zdd/config.json: hooks block updated to the new answers");
  } else ledger.kept.push("zdd/config.json");

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
  const adrDir = ledger.abs(paths.adrDir);
  mkdirSync(adrDir, { recursive: true });
  const adrFiles = readdirSync(adrDir).filter((f) => /^\d{4}-.*\.md$/.test(f));
  if (answers.seedAdr !== false) {
    if (adrFiles.length) ledger.kept.push(`${paths.adrDir}/ (${adrFiles.length} ADR${adrFiles.length === 1 ? "" : "s"} present — seed skipped)`);
    else ledger.create(`${paths.adrDir}/0001-adopt-zero-drift-docs.md`, readFileSync(join(TEMPLATES, "adr-0001-adopt-zero-drift-docs.md"), "utf8").replace("<DATE>", date));
  } else ledger.skipped.push(`${paths.adrDir}/0001-adopt-zero-drift-docs.md (declined)`);
  mkdirSync(ledger.abs(paths.metadataDir), { recursive: true });

  // --- opt-ins ------------------------------------------------------------
  ledger.notes.push(`hooks: autoLoad ${optIns.autoLoad ? "on" : "off"}, fence ${optIns.fence ? "on" : "off"} (recorded in zdd/config.json; the plugin's hooks.json reads it)`);

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

  const pocock = findPocock(root, home);
  return { mode, version, date, config, optIns, pocock, detection, ...ledgerOut(ledger) };
}

function ledgerOut(l) {
  return { wrote: l.wrote, kept: l.kept, skipped: l.skipped, notes: l.notes };
}

// ---------------------------------------------------------------------------
// upgrade
// ---------------------------------------------------------------------------
export function upgrade(root) {
  const ledger = new Ledger(root);
  const version = pluginVersion();
  const cfg = readConfig(root);
  if (cfg.state === "absent") throw new Error(`no zdd/config.json under ${root} — nothing to upgrade (run bootstrap without --upgrade to adopt)`);
  if (cfg.state === "invalid") throw new Error(`${cfg.error} — fix it by hand; upgrade never rewrites a config it cannot read`);
  const config = cfg.config;
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
      ledger.kept.push(`${rel} (not managed by zdd — left untouched; check its engine pin by hand)`);
      continue;
    }
    const next = rel.endsWith("pre-push") ? fresh() : pinEngine(cur, version);
    if (next !== cur) {
      ledger.overwrite(rel, next);
      ledger.notes.push(`${rel}: ${rel.endsWith("pre-push") ? "rewritten from the template" : "engine pin updated"} (${version})`);
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
  ledger.notes.push("curated artifacts (glossary, ADRs, map, metadata) untouched — upgrade never writes them");
  ledger.notes.push("if the engine pin moved: run `render` and commit the regenerated artifacts in the same PR");
  return { version, ...ledgerOut(ledger) };
}

// ---------------------------------------------------------------------------
// Narration
// ---------------------------------------------------------------------------
function narrateDetect(d, pocock) {
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
  }
  out.push(narratePocock(pocock));
  return out.join("\n");
}

function narratePocock(p) {
  if (p.installed) return `mattpocock-skills: installed (${p.hits[0].where}: ${p.hits[0].path}) — \`grill\` will run the real interview.`;
  return (
    "mattpocock-skills: NOT installed. Recommended, never required: your glossary and ADRs will only be as good as the design " +
    "sessions that fill them, and `grill` (the design interview that writes them as it goes) needs Matt Pocock's skills. " +
    "Install: `/plugin marketplace add mattpocock/skills` then `/plugin install mattpocock-skills@skills` (Claude Code). " +
    "Without it, work decisions out in plan mode and let \"update ZDD\" capture them."
  );
}

function narrateApply(r) {
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
  return out.join("\n");
}

function narrateUpgrade(r) {
  const out = [`Upgrade to plugin ${r.version}`];
  if (!r.wrote.length) out.push("  nothing to change — every plugin-owned file is already at this version");
  for (const f of r.wrote) out.push(`  changed ${f}`);
  for (const f of r.kept) out.push(`  kept    ${f}`);
  for (const n of r.notes) out.push(`  note    ${n}`);
  return out.join("\n");
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
      const r = upgrade(root);
      process.stdout.write(flags.json ? JSON.stringify(r, null, 2) + "\n" : narrateUpgrade(r) + "\n");
    } else {
      process.stderr.write("Usage: bootstrap.mjs <detect|apply --answers=<file>|upgrade> [--root=<dir>] [--date=YYYY-MM-DD] [--home=<dir>] [--json]\n");
      process.exit(2);
    }
  } catch (e) {
    process.stderr.write(`bootstrap: ${e.message}\n`);
    process.exit(1);
  }
}
